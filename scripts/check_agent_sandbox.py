"""Run trusted adversarial fixtures in the Linux boundary; no real model calls."""

import json
import os
import shutil
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from src.server.agent import ModeBuildError, OpenCodeAgent
from src.server.config import Settings
from src.server.sandbox import AgentSandbox

hits = []


class Canary(BaseHTTPRequestHandler):
    def do_GET(self):
        hits.append(self.path)
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):
        pass


canary = HTTPServer(("127.0.0.1", 0), Canary)
threading.Thread(target=canary.serve_forever, daemon=True).start()
with tempfile.TemporaryDirectory(prefix="agent-security-tests-") as directory:
    root = Path(directory)
    other = root / "other-user"
    other.mkdir()
    secret = other / "private.txt"
    secret.write_text("fake other-user secret")
    parent_secret = root / "aws-credentials"
    parent_secret.write_text("fake AWS server secret")
    workspace = root / "current-user/workspace"
    runtime = root / "current-user/runtime"
    config = root / "current-user/config"
    for path in (workspace, runtime, config):
        path.mkdir(parents=True)
    (config / "opencode.json").write_text("{}")
    shutil.copyfile(
        Path(__file__).with_name("agent-security-probe.mjs"), workspace / "probe.mjs"
    )
    os.environ["AWS_SECRET_ACCESS_KEY"] = "parent-only-aws-key"
    settings = Settings(meta_api_key="parent-only-meta-key")
    relayed = []
    with AgentSandbox(settings, workspace, config, runtime) as sandbox:

        def upstream(body, headers, chunk):
            relayed.append(json.loads(body))
            headers(200, "application/json")
            chunk(b'{"ok": true}')

        sandbox.relay.upstream = upstream
        command = sandbox.command(
            [
                "run",
                str(workspace / "probe.mjs"),
                str(secret),
                str(parent_secret),
                str(os.getpid()),
                str(canary.server_port),
            ]
        )
        env = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "BUN_BE_BUN": "1",
            "TMPDIR": str(runtime),
            "HOME": str(runtime),
            "META_API_KEY": "sandbox-placeholder",
        }
        process = subprocess.Popen(
            command,
            cwd=workspace,
            env=env,
            pass_fds=sandbox.pass_fds,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        sandbox.start(process.pid)
        stdout, stderr = process.communicate(timeout=30)
        if process.returncode:
            raise RuntimeError(
                f"Security fixture failed ({process.returncode}): {stderr}\n{stdout}"
            )
        result = json.loads(stdout)
        assert all(
            listener.getsockname()[0] == "127.0.0.1"
            for listener in sandbox.relay.listeners.values()
        )
    assert secret.read_text() == "fake other-user secret"
    assert parent_secret.read_text() == "fake AWS server secret"
    assert not hits, "The agent reached a real local server"
    assert len(relayed) == 1
    # The trusted compiler has an independent, network-disabled sandbox.
    (workspace / "mode.ts").write_text("""
import type { ModeContext, PlayMode } from '@taptaptap/engine/types';
export default class CustomMode implements PlayMode {
  constructor(private context: ModeContext) {}
  onKey(character: string): void { this.context.createLetter(character); }
  update(delta: number): void {}
  resize(): void {}
  dispose(): void {}
}
""")
    try:
        assert "class" in OpenCodeAgent(Settings()).build_mode(workspace)
    except ModeBuildError as error:
        raise RuntimeError(error.diagnostics) from error
    result["offline_compiler"] = "passed"
    result["canary_connections"] = len(hits)
    result["model_calls"] = 0
    print(json.dumps(result))
canary.shutdown()
