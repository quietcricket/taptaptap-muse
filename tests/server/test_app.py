import hashlib
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit

import boto3
import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient
from moto import mock_aws

from server.agent import AgentResult, ModeBuildError
from server.app import create_app
from server.config import Settings
from server.workspace import WorkspaceViolation

ORIGIN = "http://localhost:8080"


def table():
    return boto3.resource("dynamodb", region_name="ap-southeast-1").Table("taptaptap")


@pytest.fixture(autouse=True)
def dynamodb(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    with mock_aws():
        table().meta.client.create_table(
            TableName="taptaptap",
            BillingMode="PAY_PER_REQUEST",
            KeySchema=[
                {"AttributeName": "pk", "KeyType": "HASH"},
                {"AttributeName": "sk", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "pk", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "S"},
            ],
        )
        yield


class Mailbox:
    def __init__(self):
        self.links = []
        self.fail = False

    def send_login(self, email, link):
        if self.fail:
            raise RuntimeError("Provider secret must not appear in the response")
        self.links.append((email, link))

    def token(self):
        return parse_qs(urlsplit(self.links[-1][1]).fragment)["token"][0]


class Agent:
    configured = True
    fail = False
    calls = []

    def turn(self, messages, html, *, user_id, project_id, on_progress=None):
        self.calls.append((messages, html))
        if self.fail:
            raise RuntimeError("Secret internal failure")
        return AgentResult(reply="Created your snow world.", html="<h1>Snow</h1>")


@pytest.fixture
def setup(tmp_path):
    static = tmp_path / "dist"
    static.mkdir()
    (static / "index.html").write_text("<h1>Playground</h1>")
    (static / "studio.html").write_text("<h1>Studio</h1>")
    settings = Settings(static_dir=static)
    mail = Mailbox()
    agent = Agent()
    agent.calls = []
    with TestClient(
        create_app(settings, mailer=mail, agent=agent),
        base_url=ORIGIN,
        headers={"origin": ORIGIN},
    ) as client:
        yield client, mail, agent, settings


def sign_in(client, mail, email="parent@example.com"):
    assert (
        client.post("/api/auth/request-link", json={"email": email}).status_code == 202
    )
    response = client.post("/api/auth/verify", json={"token": mail.token()})
    assert response.status_code == 200
    return response


def test_registration_requires_email_possession_and_one_time_token(setup):
    client, mail, _, settings = setup
    assert client.get("/api/auth/me").status_code == 401
    assert (
        client.post(
            "/api/auth/request-link", json={"email": "Parent@EXAMPLE.com"}
        ).status_code
        == 202
    )
    token = mail.token()
    items = table().scan()["Items"]
    assert not any(item["sk"] == "PROFILE" for item in items)
    token_key = "TOKEN#" + hashlib.sha256(token.encode()).hexdigest()
    assert any(item["pk"] == token_key for item in items)
    assert token not in str(items)
    response = client.post("/api/auth/verify", json={"token": token})
    assert response.json()["email"] == "parent@example.com"
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=lax" in response.headers["set-cookie"]
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/verify", json={"token": token}).status_code == 400
    assert client.post("/api/auth/logout", json={}).status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_expired_links_and_sessions_are_rejected(setup, monkeypatch):
    client, mail, _, settings = setup
    client.post("/api/auth/request-link", json={"email": "parent@example.com"})
    token_key = "TOKEN#" + hashlib.sha256(mail.token().encode()).hexdigest()
    table().update_item(
        Key={"pk": token_key, "sk": "TOKEN"},
        UpdateExpression="SET expires_at = :expired",
        ExpressionAttributeValues={":expired": int(time.time()) - 1},
    )
    assert (
        client.post("/api/auth/verify", json={"token": mail.token()}).status_code == 400
    )
    now = int(time.time()) + 60
    monkeypatch.setattr("server.app.time.time", lambda: now)
    sign_in(client, mail)
    for item in table().scan()["Items"]:
        if item["sk"] == "SESSION":
            table().update_item(
                Key={"pk": item["pk"], "sk": "SESSION"},
                UpdateExpression="SET expires_at = :zero",
                ExpressionAttributeValues={":zero": 0},
            )
    assert client.get("/api/auth/me").status_code == 401


def test_origin_validation_and_auth_rate_limits(setup, monkeypatch):
    client, mail, _, _ = setup
    body = {"email": "parent@example.com"}
    assert (
        client.post(
            "/api/auth/request-link",
            json=body,
            headers={"origin": "https://evil.example"},
        ).status_code
        == 403
    )
    now = int(time.time())
    monkeypatch.setattr("server.app.time.time", lambda: now)
    for _ in range(3):
        assert client.post("/api/auth/request-link", json=body).status_code == 202
        now += 60
    limited = client.post("/api/auth/request-link", json=body)
    assert limited.status_code == 429
    assert limited.headers["Retry-After"] == "900"
    assert len(mail.links) == 3
    assert (
        client.post("/api/auth/request-link", json={"email": "invalid"}).status_code
        == 422
    )


def test_email_cooldown_is_shared_between_app_instances(setup, monkeypatch):
    client, mail, agent, settings = setup
    now = int(time.time())
    monkeypatch.setattr("server.app.time.time", lambda: now)
    response = client.post(
        "/api/auth/request-link", json={"email": "Parent@EXAMPLE.com"}
    )
    assert response.status_code == 202
    assert response.json()["retry_after"] == 60
    assert response.headers["Retry-After"] == "60"
    with TestClient(
        create_app(settings, mailer=mail, agent=agent),
        base_url=ORIGIN,
        headers={"origin": ORIGIN},
    ) as other:
        now += 17
        for _ in range(4):
            blocked = other.post(
                "/api/auth/request-link", json={"email": "parent@example.com"}
            )
            assert blocked.status_code == 429
            assert blocked.headers["Retry-After"] == "43"
        assert len(mail.links) == 1
        assert len([i for i in table().scan()["Items"] if i["sk"] == "TOKEN"]) == 1
        now += 43
        assert (
            other.post(
                "/api/auth/request-link", json={"email": "parent@example.com"}
            ).status_code
            == 202
        )
        assert len(mail.links) == 2


def test_failed_delivery_invalidates_token_and_hides_details(setup):
    client, mail, _, settings = setup
    mail.fail = True
    response = client.post(
        "/api/auth/request-link", json={"email": "parent@example.com"}
    )
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "60"
    assert "secret" not in response.text.lower()
    assert not any(item["sk"] == "TOKEN" for item in table().scan()["Items"])


def test_private_modes_chat_history_and_failure_recovery(setup, monkeypatch):
    client, mail, agent, settings = setup
    assert client.post("/api/projects", json={"name": "Snow"}).status_code == 401
    sign_in(client, mail)
    project = client.post("/api/projects", json={"name": "Snow"}).json()
    path = f"/api/projects/{project['id']}"
    result = client.post(f"{path}/messages", json={"content": "Make snowflakes"})
    assert result.status_code == 200
    assert result.json()["html"] == "<h1>Snow</h1>"
    saved = client.get(path).json()
    assert saved["messages"][0]["content"] == "Make snowflakes"
    assert len(saved["messages"]) == 2
    agent.fail = True
    failed = client.post(f"{path}/messages", json={"content": "Make them blue"})
    assert failed.status_code == 502
    assert "Secret" not in failed.text
    assert client.get(path).json()["messages"] == saved["messages"]
    assert client.get(path).json()["busy_until"] == 0
    agent.fail = False
    assert (
        client.post(f"{path}/messages", json={"content": "Try again"}).status_code
        == 200
    )
    assert agent.calls[-1][1] == "<h1>Snow</h1>"
    client.post("/api/auth/logout", json={})
    sign_in(client, mail, "another@example.com")
    assert client.get("/api/projects").json() == []
    assert client.get(path).status_code == 404
    assert client.get(f"{path}/progress").status_code == 404
    assert (
        client.post(f"{path}/messages", json={"content": "Read this"}).status_code
        == 404
    )
    # Durable across app instances, with no in-memory account or project state.
    with TestClient(
        create_app(settings, mailer=mail, agent=agent),
        base_url=ORIGIN,
        headers={"origin": ORIGIN},
    ) as other:
        now = int(time.time()) + 60
        monkeypatch.setattr("server.app.time.time", lambda: now)
        sign_in(other, mail)
        assert other.get(path).json()["html"] == "<h1>Snow</h1>"


def test_unconfigured_agent_and_static_routing(tmp_path):
    settings = Settings()
    mail = Mailbox()
    with TestClient(
        create_app(settings, mailer=mail), base_url=ORIGIN, headers={"origin": ORIGIN}
    ) as client:
        sign_in(client, mail)
        project = client.post("/api/projects", json={"name": "Snow"}).json()
        assert client.get("/api/studio/status").json() == {"agent_configured": False}
        assert (
            client.post(
                f"/api/projects/{project['id']}/messages", json={"content": "Snow"}
            ).status_code
            == 503
        )
        assert client.get("/api/missing").status_code == 404


def test_static_html_health_and_no_cache_on_api(setup):
    client, _, _, _ = setup
    assert "Playground" in client.get("/").text
    assert "Studio" in client.get("/studio.html").text
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/health").headers["cache-control"] == "no-store"
    assert client.get("/api/missing").status_code == 404


def test_public_config_requires_secure_email_and_origin():
    with pytest.raises(ValueError):
        Settings(app_url="http://public.example")
    with pytest.raises(ValueError):
        Settings(app_url="https://public.example")
    with pytest.raises(ValueError):
        Settings(app_url="https://public.example/path")
    Settings(
        app_url="https://public.example",
        email_delivery="ses",
        email_from="hello@public.example",
    )


def test_busy_mode_rejects_overlapping_turns(setup):
    client, mail, agent, settings = setup
    sign_in(client, mail)
    project = client.post("/api/projects", json={"name": "Snow"}).json()
    table().update_item(
        Key={"pk": f"PROJECT#{project['id']}", "sk": "META"},
        UpdateExpression="SET busy_until = :until",
        ExpressionAttributeValues={":until": int(time.time()) + 300},
    )
    path = f"/api/projects/{project['id']}"
    assert (
        client.post(f"{path}/messages", json={"content": "Blue snow"}).status_code
        == 409
    )
    assert agent.calls == []
    assert client.get(path).json()["messages"] == []


def test_mode_class_source_is_saved_and_reused_on_followup(setup):
    client, mail, agent, _ = setup
    sign_in(client, mail)
    project = client.post("/api/projects", json={"name": "Snow"}).json()
    path = f"/api/projects/{project['id']}"
    seen = []
    source = "export default class CustomMode { /* Snow */ }"
    javascript = "export default class CustomMode {}"

    def turn(messages, previous, *, user_id, project_id, on_progress=None):
        assert user_id == hashlib.sha256(b"parent@example.com").hexdigest()
        assert project_id == project["id"]
        seen.append(previous)
        return AgentResult(reply="Ready", source=source, javascript=javascript)

    agent.turn = turn
    response = client.post(f"{path}/messages", json={"content": "Snow please"})
    assert response.status_code == 200
    assert response.json()["source"] == source
    assert response.json()["javascript"] == javascript
    assert response.json()["html"] == ""
    assert client.get(path).json()["source"] == source
    assert (
        client.post(f"{path}/messages", json={"content": "Make it blue"}).status_code
        == 200
    )
    assert seen == ["", source]


def test_other_user_cannot_invoke_agent_or_modify_saved_mode(setup):
    client, mail, agent, _ = setup
    sign_in(client, mail, "liang.shang@gmail.com")
    project = client.post("/api/projects", json={"name": "Butterflies"}).json()
    path = f"/api/projects/{project['id']}"
    saved = client.get(path).json()
    sign_in(client, mail, "other@example.com")
    assert client.get(path).status_code == 404
    assert (
        client.post(
            f"{path}/messages", json={"content": "Change another user's mode"}
        ).status_code
        == 404
    )
    assert agent.calls == []
    assert (
        table().get_item(Key={"pk": f"PROJECT#{project['id']}", "sk": "META"})["Item"][
            "version"
        ]
        == 0
    )
    assert saved["messages"] == []


@pytest.mark.parametrize(
    "error,status,detail",
    [
        (ModeBuildError("private source and paths"), 502, "code checks"),
        (WorkspaceViolation("private other-user path"), 502, "file permissions"),
        (subprocess.TimeoutExpired("opencode", 95), 504, "timed out"),
    ],
)
def test_agent_failures_release_lease_and_keep_saved_mode(setup, error, status, detail):
    client, mail, agent, _ = setup
    sign_in(client, mail)
    project = client.post("/api/projects", json={"name": "Butterflies"}).json()
    path = f"/api/projects/{project['id']}"

    def fail(*args, **kwargs):
        raise error

    agent.turn = fail
    response = client.post(f"{path}/messages", json={"content": "Butterflies"})
    assert response.status_code == status
    assert detail in response.json()["detail"]
    assert "private" not in response.text
    saved = client.get(path).json()
    assert saved["busy_until"] == 0
    assert saved["messages"] == []
    assert saved["source"] == ""


def test_progress_is_available_while_the_model_request_is_running(setup):
    client, mail, agent, _ = setup
    sign_in(client, mail)
    project = client.post("/api/projects", json={"name": "Butterflies"}).json()
    path = f"/api/projects/{project['id']}"
    started = threading.Event()
    finish = threading.Event()

    def turn(*args, on_progress, **kwargs):
        on_progress("Updating your mode.")
        started.set()
        assert finish.wait(timeout=5)
        return AgentResult(reply="Ready", html="<h1>Butterflies</h1>")

    agent.turn = turn
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(
            client.post, f"{path}/messages", json={"content": "Butterflies"}
        )
        try:
            assert started.wait(timeout=3)
            activity = client.get(f"{path}/progress")
            assert activity.status_code == 200
            assert activity.json()["state"] == "running"
            assert activity.json()["events"][-1]["message"] == "Updating your mode."
        finally:
            finish.set()
        assert pending.result(timeout=5).status_code == 200
    assert client.get(f"{path}/progress").json()["state"] == "complete"


def test_https_sessions_are_secure_and_missing_origin_is_rejected(tmp_path):
    settings = Settings(
        app_url="https://play.example.com",
        email_delivery="ses",
        email_from="hello@example.com",
    )
    mail = Mailbox()
    with TestClient(
        create_app(settings, mailer=mail), base_url=settings.app_url
    ) as client:
        body = {"email": "parent@example.com"}
        assert client.post("/api/auth/request-link", json=body).status_code == 403
        client.headers["origin"] = settings.app_url
        assert client.post("/api/auth/request-link", json=body).status_code == 202
        response = client.post("/api/auth/verify", json={"token": mail.token()})
        assert response.status_code == 200
        assert "Secure" in response.headers["set-cookie"]
        assert client.get("/api/auth/me").status_code == 200


def test_ses_error_logs_code_without_exposing_recipient_or_token(setup, caplog):
    client, mail, _, _ = setup
    failure = ClientError(
        {"Error": {"Code": "MessageRejected", "Message": "secret recipient and token"}},
        "SendEmail",
    )
    mail.send_login = Mock(side_effect=failure)
    response = client.post(
        "/api/auth/request-link", json={"email": "parent@example.com"}
    )
    assert response.status_code == 503
    assert "MessageRejected" in caplog.text
    assert "secret recipient and token" not in caplog.text
    assert "parent@example.com" not in caplog.text
    assert "secret" not in response.text
