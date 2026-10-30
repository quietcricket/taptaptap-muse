"""Create only the isolated Docker development table, with fake credentials."""

import time

import boto3
from botocore.exceptions import ClientError, EndpointConnectionError

client = boto3.client(
    "dynamodb",
    endpoint_url="http://dynamodb:8000",
    region_name="ap-southeast-1",
    aws_access_key_id="local",
    aws_secret_access_key="local",
)
for attempt in range(30):
    try:
        client.list_tables()
        break
    except EndpointConnectionError:
        if attempt == 29:
            raise
        time.sleep(1)
try:
    client.create_table(
        TableName="taptaptap-local",
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
except ClientError as error:
    if error.response["Error"]["Code"] != "ResourceInUseException":
        raise
print("Isolated local DynamoDB table ready.")
