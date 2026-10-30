from unittest.mock import Mock

import boto3
import pytest

from server.config import Settings
from server.email import EmailSender


@pytest.mark.parametrize(
    "ses_region,expected", [("", "ap-southeast-1"), ("us-east-1", "us-east-1")]
)
def test_email_region_is_independent_of_database_region(
    monkeypatch, ses_region, expected
):
    client = Mock()
    factory = Mock(return_value=client)
    monkeypatch.setattr(boto3, "client", factory)
    settings = Settings(
        email_delivery="ses",
        email_from="contact@birme.net",
        aws_region="ap-southeast-1",
        ses_region=ses_region,
    )
    EmailSender(settings).send_login(
        "parent@example.com", "https://example.com/#token=test"
    )
    factory.assert_called_once_with("sesv2", region_name=expected)
    assert settings.aws_region == "ap-southeast-1"
    payload = client.send_email.call_args.kwargs
    assert payload["FromEmailAddress"] == "contact@birme.net"
    assert payload["Destination"]["ToAddresses"] == ["parent@example.com"]
