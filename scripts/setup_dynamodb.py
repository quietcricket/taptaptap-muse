"""Provision app storage explicitly; the web app never creates AWS resources."""

import argparse
import time

import boto3
from botocore.exceptions import ClientError


def setup(client, name):
    try:
        table = client.describe_table(TableName=name)["Table"]
    except ClientError as error:
        if error.response["Error"]["Code"] != "ResourceNotFoundException":
            raise
        client.create_table(
            TableName=name,
            BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[
                {"AttributeName": "pk", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "pk", "KeyType": "HASH"},
                {"AttributeName": "sk", "KeyType": "RANGE"},
            ],
        )
        client.get_waiter("table_exists").wait(TableName=name)
        table = client.describe_table(TableName=name)["Table"]
    if table["KeySchema"] != [
        {"AttributeName": "pk", "KeyType": "HASH"},
        {"AttributeName": "sk", "KeyType": "RANGE"},
    ] or {
        item["AttributeName"]: item["AttributeType"]
        for item in table["AttributeDefinitions"]
    } != {"pk": "S", "sk": "S"}:
        raise ValueError("Existing table has an incompatible key schema")
    ttl = client.describe_time_to_live(TableName=name)["TimeToLiveDescription"]
    if ttl["TimeToLiveStatus"] == "DISABLED":
        client.update_time_to_live(
            TableName=name,
            TimeToLiveSpecification={"Enabled": True, "AttributeName": "expires_at"},
        )
    elif ttl.get("AttributeName") != "expires_at":
        raise ValueError("Existing table TTL must use expires_at")
    for attempt in range(12):
        try:
            client.update_continuous_backups(
                TableName=name,
                PointInTimeRecoverySpecification={"PointInTimeRecoveryEnabled": True},
            )
            break
        except ClientError as error:
            if (
                error.response["Error"]["Code"]
                != "ContinuousBackupsUnavailableException"
                or attempt == 11
            ):
                raise
            time.sleep(5)
    print(f"DynamoDB table {name} is ready (on-demand, TTL, point-in-time recovery).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default=None)
    parser.add_argument("--region", default="ap-southeast-1")
    parser.add_argument("--table", default="taptaptap")
    parser.add_argument("--endpoint-url", default=None)
    args = parser.parse_args()
    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    setup(session.client("dynamodb", endpoint_url=args.endpoint_url), args.table)
