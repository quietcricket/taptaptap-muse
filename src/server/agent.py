import hashlib
import json
import os
import shutil
import signal
import subprocess
import tempfile
import threading
import time
from pathlib import Path

from pydantic import BaseModel, Field

from .config import Settings
from .database import StoreError
from .sandbox import AgentSandbox, PrivateWorker, sandbox_command
from .workspace import WorkspaceGuard

MODEL = "meta/muse-wonder-1.0"
MAX_HTML_BYTES = 512_000
MAX_REPLY_BYTES = 32_000
MAX_SOURCE_BYTES = 128_000
MAX_JAVASCRIPT_BYTES = 256_000


def watch_activity(output, stop, report):
    offset = 0
    pending = b""
    while True:
        chunk = os.pread(output.fileno(), 64_000, offset)
        offset += len(chunk)
        pending += chunk
        lines = pending.split(b"\n")
        pending = lines.pop()[-256_000:]
        for line in lines:
            try:
                event = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                continue
            if not isinstance(event, dict):
                continue
            part = event.get("part", {})
            if not isinstance(part, dict):
                continue
            if event.get("type") == "tool_use":
                tool = part.get("tool")
                if tool == "read":
                    report("Reading your mode and the shared game features.")
                elif tool in {"edit", "write", "apply_patch"}:
                    report("Updating your mode.")
        if chunk and offset < 4_000_000:
            continue
        if stop.wait(0.2):
            return


class AgentResult(BaseModel):
    reply: str = Field(min_length=1, max_length=MAX_REPLY_BYTES)
    html: str = Field(default="", max_length=MAX_HTML_BYTES)
    source: str = Field(default="", max_length=MAX_SOURCE_BYTES)
    javascript: str = Field(default="", max_length=MAX_JAVASCRIPT_BYTES)


def read_output(root: Path, name: str, maximum: int):
    path = root / name
    if path.is_symlink() or not path.is_file() or path.stat().st_size > maximum:
        raise ValueError(f"Invalid output: {name}")
    value = path.read_text(encoding="utf-8")
    if not value.strip():
        raise ValueError(f"Empty output: {name}")
    return value


class ModeBuildError(Exception):
    def __init__(self, diagnostics: str):
        super().__init__("Generated mode failed validation")
        self.diagnostics = diagnostics


class AgentRunError(Exception):
    pass


class OpenCodeAgent:
    """File-only coding agent; no shell tools or execution of generated code."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.gate = threading.Lock()

    @property
    def configured(self):
        return bool(self.settings.meta_api_key)

    def build_mode(self, workspace: Path) -> str:
        project = Path(__file__).resolve().parents[2]
        runtime = workspace.parent / "runtime" / "compiler"
        runtime.mkdir(parents=True, exist_ok=True)
        config = workspace.parent / "config"
        config.mkdir(exist_ok=True)
        result = subprocess.run(
            sandbox_command(
                "compiler",
                0,
                workspace,
                config,
                runtime,
                [
                    "run",
                    str(project / "scripts" / "build-mode.ts"),
                    str(workspace / "mode.ts"),
                    str(workspace / "mode.js"),
                ],
            ),
            cwd=project,
            env={
                "PATH": "/usr/local/bin:/usr/bin:/bin",
                "BUN_BE_BUN": "1",
                "TMPDIR": str(runtime),
                "HOME": str(runtime),
            },
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
            check=False,
        )
        if result.returncode:
            # Keep source/diagnostics in the current user's context, never logs.
            raise ModeBuildError(result.stderr[-12000:])
        return read_output(workspace, "mode.js", MAX_JAVASCRIPT_BYTES)

    def turn(
        self,
        messages: list[dict],
        source: str,
        *,
        user_id: str,
        project_id: str,
        on_progress=None,
    ) -> AgentResult:
        if not self.configured:
            raise StoreError(503, "Meta Muse is not configured for mode creation.")
        if not self.gate.acquire(blocking=False):
            raise StoreError(503, "Meta Muse is busy. Please try again shortly.")
        report = on_progress or (lambda message: None)
        scope = hashlib.sha256(f"{user_id}:{project_id}".encode()).hexdigest()
        deadline = time.monotonic() + self.settings.agent_timeout_seconds
        try:
            with tempfile.TemporaryDirectory(
                prefix=f"taptaptap-user-{hashlib.sha256(user_id.encode()).hexdigest()[:16]}-{scope[:12]}-"
            ) as directory:
                root = Path(directory)
                runtime = root / "runtime"
                runtime.mkdir()
                for name in ("data", "cache", "state", "tmp", "home"):
                    (runtime / name).mkdir()
                workspace = root / "workspace"
                workspace.mkdir()
                project = Path(__file__).resolve().parents[2]
                reference = workspace / "reference"
                for name in ("engine", "modes"):
                    shutil.copytree(project / "src" / name, reference / name)
                legacy = source.lstrip().startswith("<")
                (workspace / "request.json").write_text(
                    json.dumps(
                        {
                            "scope": {"user_id": user_id, "project_id": project_id},
                            "messages": messages,
                            "previous_html": source if legacy else "",
                        },
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )
                template = (project / "src/modes/custom-template.ts").read_text()
                template = template.replace(
                    "'../engine/types'", "'@taptaptap/engine/types'"
                )
                (workspace / "mode.ts").write_text(
                    source if source and not legacy else template, encoding="utf-8"
                )
                # Neither AWS nor the real Meta credential enters the child.
                # The relay holds authentication outside the kernel boundary.
                env = {
                    "PATH": "/usr/local/bin:/usr/bin:/bin",
                    # Only the parent relay has the real API key.
                    "META_API_KEY": "sandbox-placeholder",
                    "XDG_CONFIG_HOME": str(root / "config"),
                    "XDG_DATA_HOME": str(runtime / "data"),
                    "XDG_CACHE_HOME": str(runtime / "cache"),
                    "XDG_STATE_HOME": str(runtime / "state"),
                    "TMPDIR": str(runtime / "tmp"),
                    "HOME": str(runtime / "home"),
                }
                # The image has immutable system config. Native development uses
                # the same tracked template in the private per-turn config folder.
                config_dir = root / "config" / "opencode"
                config_dir.mkdir(parents=True)
                config_path = (
                    Path(__file__).resolve().parents[2] / "infra" / "opencode.json"
                )
                config = json.loads(config_path.read_text(encoding="utf-8"))
                config["providers"]["meta"]["settings"].update(
                    baseURL="http://127.0.0.1:9/v1", apiKey="sandbox-placeholder"
                )
                (config_dir / "opencode.json").write_text(
                    json.dumps(config),
                    encoding="utf-8",
                )
                command = [
                    "opencode",
                    "run",
                    "--format",
                    "json",
                    "--agent",
                    "typing-mode",
                    "--model",
                    MODEL,
                    "Read request.json and reference/engine/types.ts. "
                    "Update the single mode class in mode.ts and write reply.txt.",
                ]
                request_path = workspace / "request.json"
                for attempt in range(2):
                    report(
                        "Calling Meta Muse to create your mode."
                        if not attempt
                        else "Refining your mode after its code checks."
                    )
                    guard = WorkspaceGuard(workspace)
                    with (
                        PrivateWorker(
                            self.settings, workspace, root / "config", runtime, env
                        ) as worker,
                        AgentSandbox(
                            self.settings,
                            workspace,
                            root / "config",
                            runtime,
                            relay=worker.relay,
                        ) as sandbox,
                        tempfile.TemporaryFile() as output,
                    ):
                        process = subprocess.Popen(
                            sandbox.command([*command[1:], "--server", worker.url]),
                            cwd=workspace,
                            env=worker.env,
                            stdout=output,
                            stderr=output,
                            start_new_session=True,
                            pass_fds=sandbox.pass_fds,
                        )
                        sandbox.start(process.pid)
                        stop = threading.Event()
                        watcher = threading.Thread(
                            target=watch_activity,
                            args=(output, stop, report),
                            daemon=True,
                        )
                        watcher.start()
                        try:
                            code = process.wait(
                                timeout=max(1, deadline - time.monotonic())
                            )
                        except BaseException as error:
                            try:
                                os.killpg(process.pid, signal.SIGKILL)
                            except ProcessLookupError:
                                pass
                            process.wait(timeout=5)
                            if isinstance(error, subprocess.TimeoutExpired):
                                output.seek(0)
                                self.save_debug(
                                    scope,
                                    user_id,
                                    project_id,
                                    attempt,
                                    "",
                                    "Process deadline exceeded.\n"
                                    + output.read(64_000).decode(
                                        "utf-8", errors="replace"
                                    ),
                                )
                            raise
                        finally:
                            stop.set()
                            watcher.join(timeout=1)
                        guard.verify()
                        if code or output.tell() > 4_000_000:
                            output.seek(0)
                            diagnostics = output.read(64_000).decode(
                                "utf-8", errors="replace"
                            )
                            self.save_debug(
                                scope, user_id, project_id, attempt, "", diagnostics
                            )
                            raise AgentRunError("OpenCode did not complete the turn")
                    source = read_output(workspace, "mode.ts", MAX_SOURCE_BYTES)
                    reply = read_output(workspace, "reply.txt", MAX_REPLY_BYTES)
                    # The compiler alone may create mode.js, after the guard check.
                    try:
                        report("Checking that your mode works with the game.")
                        javascript = self.build_mode(workspace)
                        result = AgentResult(
                            reply=reply, source=source, javascript=javascript
                        )
                        self.save_debug(
                            scope, user_id, project_id, attempt, source, "", result
                        )
                        return result
                    except ModeBuildError as error:
                        self.save_debug(
                            scope,
                            user_id,
                            project_id,
                            attempt,
                            source,
                            error.diagnostics,
                        )
                        if attempt or time.monotonic() >= deadline - 5:
                            raise
                        # Only the trusted host updates the immutable request.
                        # The next turn receives its own compiler feedback.
                        request = json.loads(request_path.read_text())
                        request["build_errors"] = error.diagnostics
                        request_path.write_text(json.dumps(request, ensure_ascii=False))
                        (workspace / "mode.js").unlink(missing_ok=True)
                        command[-1] = (
                            "Read request.json including build_errors. "
                            "Fix only mode.ts "
                            "to satisfy the mode contract, then update reply.txt."
                        )
                raise ValueError("OpenCode did not produce a valid mode")
        finally:
            self.gate.release()

    def save_debug(
        self, scope, user_id, project_id, attempt, source, diagnostics, result=None
    ):
        if not self.settings.agent_debug_dir:
            return
        root = Path(self.settings.agent_debug_dir) / scope
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        # The directory name comes only from a digest, never a supplied path.
        payload = {
            "user_id": user_id,
            "project_id": project_id,
            "attempt": attempt,
            "source": source,
            "diagnostics": diagnostics,
            "result": result.model_dump() if result else None,
        }
        text = json.dumps(payload, ensure_ascii=False)
        if self.settings.meta_api_key:
            text = text.replace(self.settings.meta_api_key, "[redacted]")
        path = root / f"{time.time_ns()}-{attempt}.json"
        path.write_text(text)
        path.chmod(0o600)
