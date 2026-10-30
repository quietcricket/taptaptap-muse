import pytest

from server.workspace import WorkspaceGuard, WorkspaceViolation


def workspace(root):
    root.mkdir()
    (root / "mode.ts").write_text("original mode")
    (root / "request.json").write_text("private user request")
    (root / "reference").mkdir()
    (root / "reference/types.ts").write_text("trusted contract")
    return root


def test_guard_allows_only_the_current_users_two_outputs(tmp_path):
    alice = workspace(tmp_path / "alice")
    bob = workspace(tmp_path / "bob")
    guard = WorkspaceGuard(alice)
    (alice / "mode.ts").write_text("updated mode")
    (alice / "reply.txt").write_text("done")
    guard.verify()
    assert (bob / "mode.ts").read_text() == "original mode"
    assert (bob / "request.json").read_text() == "private user request"


@pytest.mark.parametrize(
    "name", ["request.json", "reference/types.ts", "other-user.ts", ".opencode.json"]
)
def test_guard_rejects_protected_or_unexpected_changes(tmp_path, name):
    root = workspace(tmp_path / "user")
    guard = WorkspaceGuard(root)
    (root / name).write_text("unauthorized change")
    with pytest.raises(WorkspaceViolation):
        guard.verify()


def test_guard_rejects_symlink_into_another_users_files(tmp_path):
    alice = workspace(tmp_path / "alice")
    bob = workspace(tmp_path / "bob")
    guard = WorkspaceGuard(alice)
    (alice / "mode.ts").unlink()
    (alice / "mode.ts").symlink_to(bob / "mode.ts")
    with pytest.raises(WorkspaceViolation):
        guard.verify()
    assert (bob / "mode.ts").read_text() == "original mode"


def test_guard_rejects_hard_link_into_another_users_files(tmp_path):
    alice = workspace(tmp_path / "alice")
    bob = workspace(tmp_path / "bob")
    guard = WorkspaceGuard(alice)
    (alice / "mode.ts").unlink()
    (alice / "mode.ts").hardlink_to(bob / "mode.ts")
    with pytest.raises(WorkspaceViolation):
        guard.verify()
