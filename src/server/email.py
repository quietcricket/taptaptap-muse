import logging

from .config import Settings

logger = logging.getLogger("uvicorn.error")


class EmailSender:
    def __init__(self, settings: Settings):
        self.settings = settings

    def send_login(self, email: str, link: str):
        if self.settings.email_delivery == "console":
            logger.warning("LOCAL DEVELOPMENT sign-in link for %s: %s", email, link)
            return
        import boto3

        region = self.settings.ses_region or self.settings.aws_region
        boto3.client("sesv2", region_name=region).send_email(
            FromEmailAddress=self.settings.email_from,
            Destination={"ToAddresses": [email]},
            Content={
                "Simple": {
                    "Subject": {"Data": "Sign in to taptaptap"},
                    "Body": {
                        "Text": {
                            "Data": (
                                f"Sign in or create your account:\n\n{link}\n\n"
                                "This link expires in 15 minutes and works once. "
                                "Ignore this email if you did not request it."
                            )
                        }
                    },
                }
            },
        )
