import json
import subprocess
from pathlib import Path

import pytest

from server.agent import MODEL, ModeBuildError, OpenCodeAgent, read_output
from server.config import Settings
from server.database import StoreError


@pytest.fixture(autouse=True)
def fake_kernel_boundary(monkeypatch):
    # Agent unit tests mock Popen; kernel enforcement is tested in the Linux
    # integration probes, not silently disabled by the application.
    class Boundary:
        pass_fds = ()

        def __init__(self, *args, **kwargs):
            pass

        def command(self, arguments):
            return ["opencode", *arguments]

        def start(self, *args):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    class Worker:
        url = "http://127.0.0.1:40000"
        relay = None

        def __init__(self, *args):
            self.env = args[-1]

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    monkeypatch.setattr("server.agent.PrivateWorker", Worker)
    monkeypatch.setattr("server.agent.AgentSandbox", Boundary)
    monkeypatch.setattr(
        "server.agent.sandbox_command",
        lambda kind, channel, workspace, config, runtime, args: ["opencode", *args],
    )


def test_opencode_uses_pinned_model_and_isolates_runtime_credentials(monkeypatch):
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "must-not-reach-agent")
    monkeypatch.setenv("AGENT_TOKEN", "must-not-reach-agent")
    observed = {}

    class Process:
        pid = 12345

        def __init__(self, command, **kwargs):
            observed.update(command=command, **kwargs)
            root = kwargs["cwd"]
            observed["request"] = json.loads((root / "request.json").read_text())
            observed["source"] = (root / "mode.ts").read_text()
            observed["reference"] = (root / "reference/engine/types.ts").read_text()
            observed["config"] = json.loads(
                (
                    Path(kwargs["env"]["XDG_CONFIG_HOME"]) / "opencode/opencode.json"
                ).read_text()
            )
            (root / "reply.txt").write_text("Your mode is ready.")

        def wait(self, timeout):
            return 0

    monkeypatch.setattr(subprocess, "Popen", Process)
    monkeypatch.setattr(
        OpenCodeAgent,
        "build_mode",
        lambda self, root: "export default class CustomMode {}",
    )
    agent = OpenCodeAgent(Settings(meta_api_key="fake-meta-key"))
    result = agent.turn(
        [{"role": "user", "content": "$(touch /hacked)"}],
        "",
        user_id="test-user",
        project_id="test-project",
    )
    assert result.html == ""
    assert "export default class CustomMode" in result.source
    assert result.javascript == "export default class CustomMode {}"
    assert "interface ModeContext" in observed["reference"]
    assert observed["request"]["scope"] == {
        "user_id": "test-user",
        "project_id": "test-project",
    }
    assert MODEL in observed["command"]
    assert "--server" in observed["command"]
    assert "fake-meta-key" not in str(observed["command"])
    assert "$(touch /hacked)" not in str(observed["command"])
    assert observed["env"]["META_API_KEY"] == "sandbox-placeholder"
    assert "fake-meta-key" not in str(observed["env"])
    assert (
        observed["config"]["providers"]["meta"]["settings"]["baseURL"]
        == "http://127.0.0.1:9/v1"
    )
    assert "AWS_SECRET_ACCESS_KEY" not in observed["env"]
    assert "AGENT_TOKEN" not in observed["env"]
    assert not observed["cwd"].exists()
    assert "fake-meta-key" not in repr(agent.settings)


def test_compiler_feedback_repairs_only_the_current_workspace(monkeypatch):
    requests = []

    class Process:
        pid = 12345

        def __init__(self, command, **kwargs):
            root = kwargs["cwd"]
            requests.append(json.loads((root / "request.json").read_text()))
            (root / "reply.txt").write_text("Fixed your mode")

        def wait(self, timeout):
            return 0

    def compile_mode(self, workspace):
        if len(requests) == 1:
            raise ModeBuildError("TS2322: use the expected ModeContext type")
        return "export default class CustomMode {}"

    monkeypatch.setattr(subprocess, "Popen", Process)
    monkeypatch.setattr(OpenCodeAgent, "build_mode", compile_mode)
    result = OpenCodeAgent(Settings(meta_api_key="fake")).turn(
        [{"role": "user", "content": "Butterflies"}],
        "",
        user_id="alice",
        project_id="butterfly",
    )
    assert result.javascript
    assert len(requests) == 2
    assert "build_errors" not in requests[0]
    assert "TS2322" in requests[1]["build_errors"]
    assert (
        requests[0]["scope"]
        == requests[1]["scope"]
        == {"user_id": "alice", "project_id": "butterfly"}
    )


def test_agent_config_limits_edits_and_denies_code_execution():
    config = json.loads(Path("infra/opencode.json").read_text())
    assert config["model"] == MODEL
    provider = config["providers"]["meta"]
    assert provider["env"] == ["META_API_KEY"]
    assert provider["settings"]["baseURL"] == "http://127.0.0.1:9/v1"
    assert provider["settings"]["apiKey"] == "{env:META_API_KEY}"
    assert provider["body"]["include"] == ["reasoning.encrypted_content"]
    rules = config["agents"]["typing-mode"]["permissions"]

    def effect(action, resource):
        from fnmatch import fnmatchcase

        matches = [
            rule["effect"]
            for rule in rules
            if fnmatchcase(action, rule["action"])
            and fnmatchcase(resource, rule["resource"])
        ]
        return matches[-1] if matches else "ask"

    assert effect("read", "request.json") == "allow"
    assert effect("edit", "mode.ts") == "allow"
    assert effect("read", "reference/engine/types.ts") == "allow"
    assert effect("edit", "reply.txt") == "allow"
    for action, resource in [
        ("shell", "env"),
        ("execute", "*"),
        ("read", "/proc/self/environ"),
        ("read", "/app/.env"),
        ("edit", "opencode.json"),
        ("edit", "reference/engine/types.ts"),
        ("edit", "mode.html"),
        ("edit", "mode.js"),
        ("external_directory", "/app/*"),
        ("webfetch", "*"),
        ("subagent", "*"),
    ]:
        assert effect(action, resource) == "deny"


def test_compiler_is_a_separate_process_without_model_or_aws_keys(
    monkeypatch, tmp_path
):
    monkeypatch.setenv("META_API_KEY", "never-inherit")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "never-inherit")
    observed = {}

    def run(command, **kwargs):
        observed.update(command=command, **kwargs)
        Path(command[-1]).write_text("export default class CustomMode {}")
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(subprocess, "run", run)
    result = OpenCodeAgent(Settings(meta_api_key="fake")).build_mode(tmp_path)
    assert "export default class" in result
    assert observed["command"][0:2] == ["opencode", "run"]
    assert observed["command"][-2:] == [
        str(tmp_path / "mode.ts"),
        str(tmp_path / "mode.js"),
    ]
    assert set(observed["env"]) == {"PATH", "BUN_BE_BUN", "TMPDIR", "HOME"}
    assert observed["timeout"] == 30


def test_local_diagnostics_reject_public_origins_and_redact_meta_key(tmp_path):
    with pytest.raises(ValueError, match="only for local"):
        Settings(
            app_url="https://taptaptap.birme.net",
            email_delivery="ses",
            email_from="contact@birme.net",
            agent_debug_dir=str(tmp_path),
        )
    agent = OpenCodeAgent(
        Settings(meta_api_key="private-meta-key", agent_debug_dir=str(tmp_path))
    )
    agent.save_debug("safe-scope", "user", "project", 0, "source", "private-meta-key")
    files = list((tmp_path / "safe-scope").glob("*.json"))
    assert len(files) == 1
    assert "private-meta-key" not in files[0].read_text()
    assert "[redacted]" in files[0].read_text()
    assert files[0].stat().st_mode & 0o777 == 0o600


def test_agent_rejects_missing_key_and_busy_process():
    with pytest.raises(StoreError) as error:
        OpenCodeAgent(Settings()).turn(
            [], "", user_id="test-user", project_id="test-project"
        )
    assert error.value.status == 503
    agent = OpenCodeAgent(Settings(meta_api_key="fake"))
    agent.gate.acquire()
    try:
        with pytest.raises(StoreError) as error:
            agent.turn([], "", user_id="test-user", project_id="test-project")
        assert error.value.status == 503
    finally:
        agent.gate.release()


def test_agent_kills_process_group_and_releases_lock_on_timeout(monkeypatch):
    killed = []
    roots = []

    class Process:
        pid = 12345
        waited = False

        def __init__(self, command, **kwargs):
            roots.append(kwargs["cwd"])

        def wait(self, timeout):
            if not self.waited:
                self.waited = True
                raise subprocess.TimeoutExpired("opencode", timeout)
            return -9

    monkeypatch.setattr(subprocess, "Popen", Process)
    monkeypatch.setattr("server.agent.os.killpg", lambda pid, sig: killed.append(pid))
    agent = OpenCodeAgent(Settings(meta_api_key="fake"))
    with pytest.raises(subprocess.TimeoutExpired):
        agent.turn([], "", user_id="test-user", project_id="test-project")
    assert killed == [12345]
    assert not agent.gate.locked()
    assert not roots[0].exists()


def test_output_rejects_symlinks_empty_files_and_oversized_artifacts(tmp_path):
    outside = tmp_path / "outside"
    outside.write_text("secret")
    root = tmp_path / "workspace"
    root.mkdir()
    path = root / "mode.html"
    path.symlink_to(outside)
    with pytest.raises(ValueError):
        read_output(root, "mode.html", 10)
    path.unlink()
    path.write_text("")
    with pytest.raises(ValueError):
        read_output(root, "mode.html", 10)
    path.write_text("雪" * 4)
    with pytest.raises(ValueError):
        read_output(root, "mode.html", 10)
