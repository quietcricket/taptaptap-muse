import json
import tempfile
import threading

from server.agent import watch_activity
from server.progress import ProgressRegistry, TurnProgress


def test_activity_uses_summaries_and_never_exposes_model_text_or_files():
    events = [
        {"type": "text", "part": {"text": "private model reasoning"}},
        {
            "type": "tool_use",
            "part": {"tool": "read", "input": {"path": "/private/other-user.ts"}},
        },
        {
            "type": "tool_use",
            "part": {"tool": "edit", "input": {"content": "private source"}},
        },
    ]
    messages = []
    stop = threading.Event()
    stop.set()
    with tempfile.TemporaryFile() as output:
        output.write("\n".join(json.dumps(event) for event in events).encode() + b"\n")
        output.flush()
        position = output.tell()
        watch_activity(output, stop, messages.append)
        assert output.tell() == position
    assert messages == [
        "Reading your mode and the shared game features.",
        "Updating your mode.",
    ]
    assert "private" not in str(messages)


def test_progress_deduplicates_and_bounds_activity():
    activity = TurnProgress()
    activity.add("Reading")
    activity.add("Reading")
    assert len(activity.snapshot()["events"]) == 1
    for index in range(30):
        activity.add(str(index))
    assert len(activity.snapshot()["events"]) == 20
    activity.finish("complete", "Ready")
    assert activity.snapshot()["state"] == "complete"


def test_registry_replaces_previous_turn_without_mixing_projects():
    registry = ProgressRegistry()
    alice = registry.start("alice-mode")
    alice.add("Alice activity")
    registry.start("bob-mode").add("Bob activity")
    assert registry.get("alice-mode")["events"][0]["message"] == "Alice activity"
    registry.start("alice-mode")
    assert registry.get("alice-mode")["events"] == []
    assert registry.get("bob-mode")["events"][0]["message"] == "Bob activity"
