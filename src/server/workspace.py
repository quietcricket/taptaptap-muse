"""Verify the file-only agent's output before compiling or saving a user's mode."""

import hashlib
from pathlib import Path


class WorkspaceViolation(Exception):
    pass


class WorkspaceGuard:
    editable = {"mode.ts", "reply.txt"}

    def __init__(self, root: Path):
        self.root = root.resolve()
        self.original = self.snapshot()

    def snapshot(self):
        files = {}
        for path in self.root.rglob("*"):
            if path.is_symlink():
                raise WorkspaceViolation("Symlinks are not allowed in mode workspaces")
            name = path.relative_to(self.root).as_posix()
            if path.is_dir():
                files[name + "/"] = "directory"
            elif path.is_file():
                if path.stat().st_nlink != 1:
                    raise WorkspaceViolation("Linked files are not allowed")
                files[name] = hashlib.sha256(path.read_bytes()).hexdigest()
            else:
                raise WorkspaceViolation("Unsupported workspace file type")
        return files

    def verify(self):
        current = self.snapshot()
        for name in self.original.keys() | current.keys():
            if name not in self.editable and self.original.get(name) != current.get(
                name
            ):
                raise WorkspaceViolation(
                    "The agent changed a file outside its two allowed outputs"
                )
