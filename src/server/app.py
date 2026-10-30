import hashlib
import logging
import secrets
import subprocess
import time
from contextlib import asynccontextmanager
from typing import Annotated

from botocore.exceptions import ClientError
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field

from .agent import ModeBuildError, OpenCodeAgent
from .config import Settings
from .database import Database, StoreError
from .email import EmailSender
from .progress import ProgressRegistry
from .workspace import WorkspaceViolation

COOKIE = "taptaptap_session"
SESSION_SECONDS = 30 * 24 * 60 * 60
EMAIL_COOLDOWN_SECONDS = 60


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class LoginRequest(BaseModel):
    email: EmailStr = Field(max_length=254)


class VerifyRequest(BaseModel):
    token: str = Field(min_length=32, max_length=128)


class ProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class MessageRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


def create_app(settings: Settings | None = None, mailer=None, agent=None):
    settings = settings or Settings.from_env()
    database = Database(settings)
    sender = mailer or EmailSender(settings)
    relay = agent or OpenCodeAgent(settings)
    progress = ProgressRegistry()

    @asynccontextmanager
    async def lifespan(app):
        database.initialize()
        yield

    app = FastAPI(title="taptaptap", lifespan=lifespan)

    @app.middleware("http")
    async def same_origin(request: Request, call_next):
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            if request.headers.get("origin") != settings.app_url:
                return Response("Origin not allowed", status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(StoreError)
    async def store_error(request, error):
        return JSONResponse(status_code=error.status, content={"detail": error.detail})

    @app.exception_handler(ClientError)
    async def aws_error(request, error):
        logging.getLogger("uvicorn.error").error(
            "DynamoDB operation failed: %s", error.response["Error"]["Code"]
        )
        return JSONResponse(
            status_code=503,
            content={"detail": "Storage is temporarily unavailable. Please try again."},
        )

    def current_user(request: Request):
        token = request.cookies.get(COOKIE, "")
        user = database.current_user(digest(token), int(time.time())) if token else None
        if not user:
            raise HTTPException(401, "Sign in to continue")
        return user

    User = Annotated[dict, Depends(current_user)]

    @app.get("/api/health")
    def health():
        database.health()
        return {"status": "ok"}

    @app.post("/api/auth/request-link", status_code=202)
    def request_link(body: LoginRequest, request: Request, response: Response):
        now = int(time.time())
        email = str(body.email).lower()
        remaining = database.cooldown(
            f"email:{digest(email)}", now, EMAIL_COOLDOWN_SECONDS
        )
        if remaining:
            raise HTTPException(
                429,
                "Please wait before requesting another sign-in link.",
                headers={"Retry-After": str(remaining)},
            )
        token = secrets.token_urlsafe(32)
        email_ok = database.limit(f"email:{digest(email)}", now, 3, 900)
        ip = request.client.host if request.client else "unknown"
        ip_ok = database.limit(f"ip:{ip}", now, 20, 900)
        allowed = email_ok and ip_ok
        if not allowed:
            raise HTTPException(
                429,
                "Too many requests. Please try again later.",
                headers={"Retry-After": "900"},
            )
        database.issue_token(digest(token), email, now + 900)
        try:
            sender.send_login(email, f"{settings.app_url}/studio.html#token={token}")
        except Exception as error:
            database.delete_token(digest(token))
            code = (
                error.response["Error"]["Code"]
                if isinstance(error, ClientError)
                else type(error).__name__
            )
            logging.getLogger("uvicorn.error").error(
                "Sign-in email delivery failed (%s)", code
            )
            raise HTTPException(
                503,
                "Email is unavailable. Please try again later.",
                headers={"Retry-After": str(EMAIL_COOLDOWN_SECONDS)},
            )
        response.headers["Retry-After"] = str(EMAIL_COOLDOWN_SECONDS)
        return {
            "message": "Check your email for a sign-in link.",
            "retry_after": EMAIL_COOLDOWN_SECONDS,
        }

    @app.post("/api/auth/verify")
    def verify(body: VerifyRequest, response: Response):
        now = int(time.time())
        session = secrets.token_urlsafe(32)
        user = database.verify_token(
            digest(body.token), digest(session), now, SESSION_SECONDS
        )
        response.set_cookie(
            COOKIE,
            session,
            max_age=SESSION_SECONDS,
            httponly=True,
            secure=settings.app_url.startswith("https://"),
            samesite="lax",
            path="/",
        )
        return user

    @app.get("/api/auth/me")
    def me(user: User):
        return user

    @app.post("/api/auth/logout", status_code=204)
    def logout(request: Request, response: Response):
        database.logout(digest(request.cookies.get(COOKIE, "")))
        response.delete_cookie(COOKIE, path="/")

    @app.get("/api/studio/status")
    def studio_status(user: User):
        return {"agent_configured": relay.configured}

    @app.get("/api/projects")
    def projects(user: User):
        return database.projects(user["id"])

    @app.post("/api/projects", status_code=201)
    def create_project(body: ProjectRequest, user: User):
        name = body.name.strip()
        if not name:
            raise HTTPException(422, "Enter a name for your mode")
        return database.create_project(user["id"], name, int(time.time()))

    @app.get("/api/projects/{project_id}")
    def project(project_id: str, user: User):
        return database.project(project_id, user["id"])

    @app.get("/api/projects/{project_id}/progress")
    def generation_progress(project_id: str, user: User):
        database.owned_project(project_id, user["id"])
        return progress.get(project_id)

    @app.post("/api/projects/{project_id}/messages")
    def message(project_id: str, body: MessageRequest, user: User):
        if not relay.configured:
            raise HTTPException(
                503, "Meta Muse is currently unavailable for mode creation."
            )
        content = body.content.strip()
        if not content:
            raise HTTPException(422, "Describe what you would like to create")
        now = int(time.time())
        item, lease = database.claim(project_id, user["id"], now)
        activity = progress.start(project_id)
        activity.add("Calling Meta Muse to create your mode.")
        try:
            if not database.limit(f"chat:{user['id']}", now, 30, 3600):
                raise StoreError(429, "Chat limit reached. Please try again later.")
            project = database.project(project_id, user["id"])
            result = relay.turn(
                project["messages"][-12:] + [{"role": "user", "content": content}],
                project["source"] or project["html"],
                user_id=user["id"],
                project_id=project_id,
                on_progress=activity.add,
            )
            activity.add("Saving your mode.")
            database.save_turn(item, lease, content, result, int(time.time()))
            activity.finish("complete", "Your mode is ready to play.")
            return {
                "reply": result.reply,
                "html": result.html,
                "source": result.source,
                "javascript": result.javascript,
            }
        except StoreError:
            activity.finish("failed", "Meta Muse could not complete this request.")
            raise
        except WorkspaceViolation:
            logging.getLogger("uvicorn.error").error(
                "OpenCode workspace guard rejected a turn"
            )
            raise HTTPException(
                502,
                "The mode update exceeded its file permissions. "
                "Your saved mode is unchanged.",
            )
        except ModeBuildError:
            logging.getLogger("uvicorn.error").error("OpenCode mode compilation failed")
            raise HTTPException(
                502,
                "The generated mode did not pass its code checks. "
                "Your saved mode is unchanged. Please retry.",
            )
        except subprocess.TimeoutExpired:
            logging.getLogger("uvicorn.error").error("OpenCode generation timed out")
            raise HTTPException(
                504,
                "Mode generation timed out. "
                "Your saved mode is unchanged. Please retry.",
            )
        except Exception:
            logging.getLogger("uvicorn.error").error("OpenCode request failed")
            raise HTTPException(
                502, "Meta Muse could not finish. Your saved mode is unchanged."
            )
        finally:
            if activity.snapshot()["state"] == "running":
                activity.finish(
                    "failed",
                    "Your mode could not finish. Your saved version is unchanged.",
                )
            database.release(project_id, lease)

    @app.get("/api/{path:path}", include_in_schema=False)
    def missing_api(path: str):
        raise HTTPException(404, "API route not found")

    if settings.static_dir.is_dir():

        @app.get("/")
        def index():
            return FileResponse(settings.static_dir / "index.html")

        app.mount("/", StaticFiles(directory=settings.static_dir, html=True))

    return app
