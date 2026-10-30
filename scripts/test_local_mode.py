"""Exercise the local API and real model without accessing production storage."""

import hashlib
import json
import secrets
import sys
import time
from pathlib import Path

import httpx

from src.server.config import Settings
from src.server.database import Database

PROMPT = (
    "whenever a key is pressed, the letter becomes the wings of a butterfly, "
    "appear in the middle of the screen and fly away to a random direction. "
    "randomize letter sizes and colors."
)
settings = Settings.from_env()
if (
    settings.app_url != "http://localhost:8080"
    or settings.dynamodb_endpoint_url != "http://dynamodb:8000"
    or settings.dynamodb_table != "taptaptap-local"
):
    raise SystemExit("This fixture runs only against the isolated local stack")
email = "liang.shang@gmail.com"
database = Database(settings)
token = secrets.token_urlsafe(32)
database.issue_token(
    hashlib.sha256(token.encode()).hexdigest(), email, int(time.time()) + 900
)
if "--login-only" in sys.argv:
    output = Path(settings.agent_debug_dir) / "local-test.json"
    artifact = json.loads(output.read_text())
    artifact["login_url"] = settings.app_url + "/studio.html#token=" + token
    output.write_text(json.dumps(artifact, ensure_ascii=False))
    output.chmod(0o600)
    print("Local browser sign-in link refreshed in data/local-debug/local-test.json")
    raise SystemExit(0)
with httpx.Client(
    base_url="http://127.0.0.1:8080",
    headers={"Origin": settings.app_url},
    timeout=settings.agent_timeout_seconds + 45,
) as client:
    for attempt in range(30):
        try:
            client.get("/api/health").raise_for_status()
            break
        except (httpx.ConnectError, httpx.HTTPStatusError):
            if attempt == 29:
                raise
            time.sleep(1)
    client.post("/api/auth/verify", json={"token": token}).raise_for_status()
    project_response = client.post("/api/projects", json={"name": "Butterfly letters"})
    project_response.raise_for_status()
    project = project_response.json()
    response = client.post(
        f"/api/projects/{project['id']}/messages", json={"content": PROMPT}
    )
    artifact = {
        "email": email,
        "project_id": project["id"],
        "prompt": PROMPT,
        "status": response.status_code,
        "response": response.json(),
    }
    # Create a normal one-time local sign-in link for browser verification.
    browser_token = secrets.token_urlsafe(32)
    database.issue_token(
        hashlib.sha256(browser_token.encode()).hexdigest(),
        email,
        int(time.time()) + 900,
    )
    artifact["login_url"] = settings.app_url + "/studio.html#token=" + browser_token
    output = Path(settings.agent_debug_dir) / "local-test.json"
    output.write_text(json.dumps(artifact, ensure_ascii=False))
    output.chmod(0o600)
    print(
        json.dumps(
            {
                "email": email,
                "project_id": project["id"],
                "status": response.status_code,
                "source_bytes": len(artifact["response"].get("source", "").encode()),
            }
        ),
        flush=True,
    )
    response.raise_for_status()
