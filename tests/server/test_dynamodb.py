import time

import pytest

# Reuse the isolated Moto table; no test can connect to the real AWS account.
from test_app import dynamodb  # noqa: F401

from server.agent import AgentResult
from server.config import Settings
from server.database import Database, StoreError


def account(db, token="test-token", session="test-session", now=None):
    now = now or int(time.time())
    db.issue_token(token, "parent@example.com", now + 900)
    return db.verify_token(token, session, now, 3600)


def test_large_unicode_mode_chunks_and_old_artifact_cleanup():
    db = Database(Settings())
    now = int(time.time())
    user = account(db, now=now)
    project = db.create_project(user["id"], "Unicode snow", now)
    # More than DynamoDB's 400 KiB item limit, with multibyte chunk boundaries.
    html = "<p>" + "雪" * 160_000 + "</p>"
    item, lease = db.claim(project["id"], user["id"], now)
    db.save_turn(item, lease, "Snow please", AgentResult(reply="Snow", html=html), now)
    saved = db.project(project["id"], user["id"])
    assert saved["html"] == html
    assert len(db.query(item["pk"], "HTML#")) > 1
    item, lease = db.claim(project["id"], user["id"], now)
    db.save_turn(
        item, lease, "Simplify", AgentResult(reply="Done", html="<p>Hi</p>"), now
    )
    assert db.project(project["id"], user["id"])["html"] == "<p>Hi</p>"
    assert len(db.query(item["pk"], "HTML#")) == 1
    assert len(db.project(project["id"], user["id"])["messages"]) == 4


def test_expired_lease_cannot_save_or_release_a_newer_turn():
    db = Database(Settings())
    now = int(time.time())
    user = account(db, now=now)
    project = db.create_project(user["id"], "Snow", now)
    old, old_lease = db.claim(project["id"], user["id"], now)
    new, new_lease = db.claim(project["id"], user["id"], now + 301)
    db.release(project["id"], old_lease)
    assert db.owned_project(project["id"], user["id"])["lease"] == new_lease
    result = AgentResult(reply="Done", html="<p>Hi</p>")
    with pytest.raises(Exception):
        db.save_turn(old, old_lease, "Stale", result, now + 301)
    assert db.project(project["id"], user["id"])["messages"] == []
    db.save_turn(new, new_lease, "New", result, now + 301)
    assert db.project(project["id"], user["id"])["messages"][0]["content"] == "New"


def test_project_limit_and_repeat_sign_in_keep_one_identity():
    db = Database(Settings())
    now = int(time.time())
    user = account(db, now=now)
    again = account(db, token="another-token", session="another-session", now=now)
    assert user == again
    for index in range(50):
        db.create_project(user["id"], str(index), now)
    with pytest.raises(StoreError) as error:
        db.create_project(user["id"], "Too many", now)
    assert error.value.status == 409
    assert len(db.projects(user["id"])) == 50


def test_rate_window_expiry_does_not_depend_on_ttl_cleanup():
    db = Database(Settings())
    assert db.limit("test", 1000, 2, 900)
    assert db.limit("test", 1000, 2, 900)
    assert not db.limit("test", 1000, 2, 900)
    assert db.get("LIMIT#test", "LIMIT") is not None
    assert db.limit("test", 1900, 2, 900)


def test_cooldown_does_not_extend_on_rejection_or_depend_on_ttl_cleanup():
    db = Database(Settings())
    assert db.cooldown("test", 1000, 60) == 0
    assert db.cooldown("test", 1000, 60) == 60
    assert db.cooldown("test", 1059, 60) == 1
    assert db.cooldown("other", 1059, 60) == 0
    assert db.cooldown("test", 1060, 60) == 0
    assert db.cooldown("test", 1061, 60) == 59


def test_class_artifact_replaces_legacy_html_and_keeps_source_for_edits():
    db = Database(Settings())
    now = int(time.time())
    user = account(db, now=now)
    project = db.create_project(user["id"], "Snow", now)
    item, lease = db.claim(project["id"], user["id"], now)
    db.save_turn(
        item, lease, "Old", AgentResult(reply="Old", html="<h1>Snow</h1>"), now
    )
    assert db.project(project["id"], user["id"])["html"] == "<h1>Snow</h1>"
    item, lease = db.claim(project["id"], user["id"], now)
    # More than one chunk, including multibyte input and a script closing tag.
    source = "export default class CustomMode { /*" + "雪" * 23_000 + "*/ }"
    javascript = 'export default class CustomMode { label = "</script>" }'
    db.save_turn(
        item,
        lease,
        "Reuse engine",
        AgentResult(
            reply="Done",
            source=source,
            javascript=javascript,
        ),
        now,
    )
    saved = db.project(project["id"], user["id"])
    assert saved["html"] == ""
    assert saved["source"] == source
    assert saved["javascript"] == javascript
    assert len(saved["messages"]) == 4
    assert not db.query(item["pk"], "HTML#0000000001#")
