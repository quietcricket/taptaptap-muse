import json
import socket
import threading
from unittest.mock import Mock

import pytest

from server.agent import MODEL
from server.config import Settings
from server.sandbox import (
    MODEL_ID,
    RELAY_HOST,
    MuseRelay,
    sandbox_command,
    validate_request,
)


def test_missing_sandbox_fails_closed(monkeypatch):
    monkeypatch.setattr("server.sandbox.SANDBOX", "/missing-sandbox-binary")
    with pytest.raises(RuntimeError, match="isolated agent runtime"):
        sandbox_command("agent", 3, "/user", "/config", "/runtime", ["run"])


@pytest.mark.parametrize(
    "path,host,payload",
    [
        (
            "/latest/meta-data/iam/security-credentials/",
            RELAY_HOST,
            {"model": MODEL_ID},
        ),
        ("/v1/responses", "169.254.169.254", {"model": MODEL_ID}),
        ("/v1/responses", "dynamodb:8000", {"model": MODEL_ID}),
        ("/v1/responses", "api.meta.ai.evil.invalid", {"model": MODEL_ID}),
        ("/v1/responses", RELAY_HOST, {"model": "another-model"}),
        ("/v1/responses", RELAY_HOST, {"model": MODEL_ID, "background": True}),
        (
            "/v1/responses",
            RELAY_HOST,
            {"model": MODEL_ID, "tools": [{"type": "web_search"}]},
        ),
        (
            "/v1/responses",
            RELAY_HOST,
            {"model": MODEL_ID, "input": [{"image_url": "http://169.254.169.254/"}]},
        ),
    ],
)
def test_relay_rejects_other_destinations_models_and_network_tools(path, host, payload):
    with pytest.raises(ValueError):
        validate_request(path, {"Host": host}, json.dumps(payload).encode())


def test_relay_accepts_only_the_pinned_model_and_function_tools():
    assert MODEL_ID == MODEL.split("/", 1)[1]
    payload = {
        "model": MODEL_ID,
        "input": "Make butterflies",
        "tools": [{"type": "function", "name": "read"}],
    }
    assert (
        validate_request("/v1/responses", {"Host": RELAY_HOST}, json.dumps(payload))
        == payload
    )


def test_http_relay_does_not_forward_caller_auth_or_host():
    relay = MuseRelay(Settings(meta_api_key="parent-only-secret"))
    observed = []

    def upstream(body, headers, chunk):
        observed.append(json.loads(body))
        headers(200, "application/json")
        chunk(b'{"ok": true}')

    relay.upstream = upstream
    host, child = socket.socketpair()
    worker = threading.Thread(target=relay.handle, args=(host,))
    worker.start()
    body = json.dumps({"model": MODEL_ID}).encode()
    request = (
        f"POST /v1/responses HTTP/1.1\r\nHost: {RELAY_HOST}\r\n"
        "Authorization: Bearer untrusted\r\n"
        f"Content-Length: {len(body)}\r\n\r\n"
    ).encode() + body
    child.sendall(request)
    from http.client import HTTPResponse

    response = HTTPResponse(child)
    response.begin()
    assert response.status == 200
    assert json.loads(response.read()) == {"ok": True}
    worker.join(timeout=2)
    assert observed == [{"model": MODEL_ID}]
    child.close()
    relay.close()


def test_upstream_is_fixed_tls_verified_and_holds_the_real_key(monkeypatch):
    connection = Mock()
    response = connection.getresponse.return_value
    response.status = 200
    response.getheader.return_value = "application/json"
    response.read1.side_effect = [b'{"ok":true}', b""]
    factory = Mock(return_value=connection)
    monkeypatch.setattr("server.sandbox.http.client.HTTPSConnection", factory)
    relay = MuseRelay(Settings(meta_api_key="parent-only-secret"))
    chunks = []
    relay.upstream(b"{}", lambda *args: None, chunks.append)
    assert factory.call_args.args == ("api.meta.ai", 443)
    assert factory.call_args.kwargs["context"].check_hostname
    assert connection.request.call_args.args[:2] == ("POST", "/v1/responses")
    assert (
        connection.request.call_args.kwargs["headers"]["Authorization"]
        == "Bearer parent-only-secret"
    )
    assert chunks == [b'{"ok":true}']


def test_relay_never_follows_redirects(monkeypatch):
    connection = Mock()
    connection.getresponse.return_value.status = 302
    monkeypatch.setattr(
        "server.sandbox.http.client.HTTPSConnection", Mock(return_value=connection)
    )
    relay = MuseRelay(Settings(meta_api_key="fake"))
    with pytest.raises(ValueError, match="redirects"):
        relay.upstream(b"{}", Mock(), Mock())
    assert connection.request.call_count == 1
