import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Settings:
    app_url: str = "http://localhost:8080"
    dynamodb_table: str = "taptaptap"
    dynamodb_endpoint_url: str = ""
    static_dir: Path = Path("dist")
    email_delivery: str = "console"
    email_from: str = ""
    aws_region: str = "ap-southeast-1"
    ses_region: str = ""
    agent_debug_dir: str = ""
    agent_ca_bundle: str = ""
    agent_timeout_seconds: int = 95
    meta_api_key: str = field(default="", repr=False)

    def __post_init__(self):
        if not 1 <= self.agent_timeout_seconds <= 240:
            raise ValueError("Agent timeout must be between 1 and 240 seconds")
        url = urlsplit(self.app_url)
        if (
            url.scheme not in {"http", "https"}
            or not url.netloc
            or url.path not in {"", "/"}
            or url.query
            or url.fragment
            or url.username
        ):
            raise ValueError("APP_URL must be an HTTP(S) origin without a path")
        local = url.hostname in {"localhost", "127.0.0.1", "::1"}
        if self.agent_debug_dir and not local:
            raise ValueError(
                "Agent diagnostics are available only for local development"
            )
        if not local and (url.scheme != "https" or self.email_delivery != "ses"):
            raise ValueError("Public deployments require HTTPS and SES email delivery")
        if self.email_delivery not in {"console", "ses"}:
            raise ValueError("EMAIL_DELIVERY must be console or ses")
        if self.email_delivery == "ses" and not self.email_from:
            raise ValueError("EMAIL_FROM is required for SES")

    @classmethod
    def from_env(cls):
        return cls(
            app_url=os.getenv("APP_URL", "http://localhost:8080").rstrip("/"),
            dynamodb_table=os.getenv("DYNAMODB_TABLE", "taptaptap"),
            dynamodb_endpoint_url=os.getenv("DYNAMODB_ENDPOINT_URL", ""),
            static_dir=Path(os.getenv("STATIC_DIR", "dist")),
            email_delivery=os.getenv("EMAIL_DELIVERY", "console"),
            email_from=os.getenv("EMAIL_FROM", ""),
            aws_region=os.getenv("AWS_REGION", "ap-southeast-1"),
            ses_region=os.getenv("SES_REGION", ""),
            agent_debug_dir=os.getenv("AGENT_DEBUG_DIR", ""),
            agent_ca_bundle=os.getenv("AGENT_CA_BUNDLE", ""),
            agent_timeout_seconds=int(os.getenv("AGENT_TIMEOUT_SECONDS", "95")),
            meta_api_key=os.getenv("META_API_KEY", ""),
        )
