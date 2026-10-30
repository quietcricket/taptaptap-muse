"""Bounded, per-project activity summaries; never model reasoning or source."""

import threading
import time
from collections import OrderedDict


class TurnProgress:
    def __init__(self):
        self.started = time.monotonic()
        self.state = "running"
        self.events = []
        self.lock = threading.Lock()

    def add(self, message):
        with self.lock:
            if not self.events or self.events[-1]["message"] != message:
                self.events.append(
                    {
                        "message": message,
                        "seconds": int(time.monotonic() - self.started),
                    }
                )
                self.events = self.events[-20:]

    def finish(self, state, message):
        self.add(message)
        with self.lock:
            self.state = state

    def snapshot(self):
        with self.lock:
            return {"state": self.state, "events": list(self.events)}


class ProgressRegistry:
    def __init__(self):
        self.turns = OrderedDict()
        self.lock = threading.Lock()

    def start(self, project_id):
        progress = TurnProgress()
        with self.lock:
            self.turns[project_id] = progress
            self.turns.move_to_end(project_id)
            while len(self.turns) > 128:
                self.turns.popitem(last=False)
        return progress

    def get(self, project_id):
        with self.lock:
            progress = self.turns.get(project_id)
        return progress.snapshot() if progress else {"state": "idle", "events": []}
