import hashlib
import json
import secrets

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import Binary
from botocore.exceptions import ClientError

from .config import Settings

CHUNK_BYTES = 64_000
MAX_HTML_BYTES = 512_000


class StoreError(Exception):
    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail


def canceled_condition(error, index):
    reasons = error.response.get("CancellationReasons", [])
    return (
        error.response["Error"]["Code"] == "TransactionCanceledException"
        and len(reasons) > index
        and reasons[index]["Code"] == "ConditionalCheckFailed"
    )


def conditional(error):
    return error.response["Error"]["Code"] == "ConditionalCheckFailedException"


class Database:
    def __init__(self, settings: Settings):
        self.table = boto3.resource(
            "dynamodb",
            region_name=settings.aws_region,
            endpoint_url=settings.dynamodb_endpoint_url or None,
        ).Table(settings.dynamodb_table)

    def initialize(self):
        self.table.load()
        if self.table.key_schema != [
            {"AttributeName": "pk", "KeyType": "HASH"},
            {"AttributeName": "sk", "KeyType": "RANGE"},
        ]:
            raise ValueError("DynamoDB table must have string pk/sk keys")

    def health(self):
        self.get("HEALTH", "HEALTH")

    def get(self, pk, sk):
        return self.table.get_item(Key={"pk": pk, "sk": sk}, ConsistentRead=True).get(
            "Item"
        )

    def query(self, pk, prefix, reverse=False, limit=None):
        args = {
            "KeyConditionExpression": Key("pk").eq(pk) & Key("sk").begins_with(prefix),
            "ConsistentRead": True,
            "ScanIndexForward": not reverse,
        }
        items = []
        while True:
            if limit is not None:
                args["Limit"] = limit - len(items)
            page = self.table.query(**args)
            items.extend(page.get("Items", []))
            if not page.get("LastEvaluatedKey") or (limit and len(items) >= limit):
                return items
            args["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    def transaction(self, operations):
        # The DynamoDB resource client applies its native-value serializer to
        # transaction requests too. Do not double-serialize these values.
        self.table.meta.client.transact_write_items(
            TransactItems=[
                {kind: {"TableName": self.table.name, **parameters}}
                for kind, parameters in operations
            ]
        )

    def limit(self, key, now, maximum, window):
        pk = f"LIMIT#{key}"
        for _ in range(8):
            old = self.get(pk, "LIMIT")
            reset = not old or old["window_start"] <= now - window
            if old and not reset and old["count"] >= maximum:
                return False
            values = {
                ":count": 1 if reset else int(old["count"]) + 1,
                ":start": now if reset else int(old["window_start"]),
            }
            values[":expiry"] = values[":start"] + window
            condition = "attribute_not_exists(pk)"
            if old:
                condition = "#count = :old_count AND window_start = :old_start"
                values.update(
                    {":old_count": old["count"], ":old_start": old["window_start"]}
                )
            try:
                self.table.update_item(
                    Key={"pk": pk, "sk": "LIMIT"},
                    UpdateExpression=(
                        "SET #count = :count, window_start = :start, "
                        "expires_at = :expiry"
                    ),
                    ConditionExpression=condition,
                    ExpressionAttributeNames={"#count": "count"},
                    ExpressionAttributeValues=values,
                )
                return True
            except ClientError as error:
                if not conditional(error):
                    raise
        return False

    def cooldown(self, key, now, seconds):
        pk = f"COOLDOWN#{key}"
        try:
            self.table.put_item(
                Item={"pk": pk, "sk": "COOLDOWN", "expires_at": now + seconds},
                ConditionExpression="attribute_not_exists(pk) OR expires_at <= :now",
                ExpressionAttributeValues={":now": now},
            )
            return 0
        except ClientError as error:
            if not conditional(error):
                raise
            item = self.get(pk, "COOLDOWN")
            return max(1, int(item["expires_at"]) - now) if item else 1

    def issue_token(self, token_digest, email, expires_at):
        self.table.put_item(
            Item={
                "pk": f"TOKEN#{token_digest}",
                "sk": "TOKEN",
                "email": email,
                "expires_at": expires_at,
            }
        )

    def delete_token(self, token_digest):
        self.table.delete_item(Key={"pk": f"TOKEN#{token_digest}", "sk": "TOKEN"})

    def verify_token(self, token_digest, session_digest, now, lifetime):
        token_pk = f"TOKEN#{token_digest}"
        login = self.get(token_pk, "TOKEN")
        if not login or login["expires_at"] <= now:
            raise StoreError(400, "This sign-in link is invalid or expired.")
        # Canonical email identity ensures concurrent first sign-ins cannot
        # create two users for the same email without a secondary-index race.
        user_id = hashlib.sha256(login["email"].encode()).hexdigest()
        try:
            self.transaction(
                [
                    (
                        "Delete",
                        {
                            "Key": {"pk": token_pk, "sk": "TOKEN"},
                            "ConditionExpression": "expires_at > :now",
                            "ExpressionAttributeValues": {":now": now},
                        },
                    ),
                    (
                        "Update",
                        {
                            "Key": {"pk": f"USER#{user_id}", "sk": "PROFILE"},
                            "UpdateExpression": (
                                "SET id = :id, email = :email, "
                                "created_at = if_not_exists(created_at, :now)"
                            ),
                            "ExpressionAttributeValues": {
                                ":id": user_id,
                                ":email": login["email"],
                                ":now": now,
                            },
                        },
                    ),
                    (
                        "Put",
                        {
                            "Item": {
                                "pk": f"SESSION#{session_digest}",
                                "sk": "SESSION",
                                "user_id": user_id,
                                "expires_at": now + lifetime,
                            }
                        },
                    ),
                ]
            )
        except ClientError as error:
            if canceled_condition(error, 0):
                raise StoreError(400, "This sign-in link is invalid or expired.")
            raise
        return {"id": user_id, "email": login["email"]}

    def current_user(self, session_digest, now):
        session = self.get(f"SESSION#{session_digest}", "SESSION")
        if not session or session["expires_at"] <= now:
            return None
        user = self.get(f"USER#{session['user_id']}", "PROFILE")
        return {"id": user["id"], "email": user["email"]} if user else None

    def logout(self, session_digest):
        self.table.delete_item(Key={"pk": f"SESSION#{session_digest}", "sk": "SESSION"})

    def projects(self, user_id):
        items = self.query(f"USER#{user_id}", "MODE#")
        return sorted(
            [
                {
                    "id": item["id"],
                    "name": item["name"],
                    "created_at": int(item["created_at"]),
                }
                for item in items
            ],
            key=lambda item: (-item["created_at"], item["id"]),
        )

    def create_project(self, user_id, name, now):
        project_id = secrets.token_hex(16)
        try:
            self.transaction(
                [
                    (
                        "Update",
                        {
                            "Key": {"pk": f"USER#{user_id}", "sk": "PROFILE"},
                            "UpdateExpression": "ADD project_count :one",
                            "ConditionExpression": (
                                "attribute_exists(id) AND "
                                "(attribute_not_exists(project_count) "
                                "OR project_count < :max)"
                            ),
                            "ExpressionAttributeValues": {":one": 1, ":max": 50},
                        },
                    ),
                    (
                        "Put",
                        {
                            "Item": {
                                "pk": f"PROJECT#{project_id}",
                                "sk": "META",
                                "id": project_id,
                                "user_id": user_id,
                                "name": name,
                                "created_at": now,
                                "version": 0,
                                "chunk_count": 0,
                                "busy_until": 0,
                            }
                        },
                    ),
                    (
                        "Put",
                        {
                            "Item": {
                                "pk": f"USER#{user_id}",
                                "sk": f"MODE#{project_id}",
                                "id": project_id,
                                "name": name,
                                "created_at": now,
                            }
                        },
                    ),
                ]
            )
        except ClientError as error:
            if canceled_condition(error, 0):
                raise StoreError(409, "You can keep up to 50 modes")
            raise
        return {"id": project_id, "name": name}

    def owned_project(self, project_id, user_id):
        item = self.get(f"PROJECT#{project_id}", "META")
        if not item or item["user_id"] != user_id:
            raise StoreError(404, "Mode not found")
        return item

    def project(self, project_id, user_id):
        pk = f"PROJECT#{project_id}"
        for _ in range(4):
            item = self.owned_project(project_id, user_id)
            version = int(item["version"])
            chunks = self.query(pk, f"HTML#{version:010d}#") if version else []
            messages = self.query(pk, "MSG#")
            latest = self.owned_project(project_id, user_id)
            if latest["version"] != version:
                continue
            if len(chunks) != item["chunk_count"]:
                raise RuntimeError("Incomplete mode artifact")
            artifact = b"".join(bytes(chunk["data"]) for chunk in chunks).decode(
                "utf-8"
            )
            mode = (
                json.loads(artifact)
                if item.get("artifact_format") == "mode-class-v1" and artifact
                else {"html": artifact, "source": "", "javascript": ""}
            )
            return {
                "id": item["id"],
                "name": item["name"],
                "created_at": int(item["created_at"]),
                "busy_until": int(latest["busy_until"]),
                **mode,
                "messages": [
                    {"role": message["role"], "content": message["content"]}
                    for message in messages
                    if message["version"] <= version
                ],
            }
        raise StoreError(409, "Mode changed while loading. Please try again.")

    def claim(self, project_id, user_id, now):
        self.owned_project(project_id, user_id)
        lease = secrets.token_hex(16)
        try:
            item = self.table.update_item(
                Key={"pk": f"PROJECT#{project_id}", "sk": "META"},
                UpdateExpression="SET busy_until = :until, lease = :lease",
                ConditionExpression="user_id = :user AND busy_until <= :now",
                ExpressionAttributeValues={
                    ":until": now + 300,
                    ":lease": lease,
                    ":user": user_id,
                    ":now": now,
                },
                ReturnValues="ALL_NEW",
            )["Attributes"]
        except ClientError as error:
            if conditional(error):
                raise StoreError(409, "Meta Muse is still working on this mode")
            raise
        return item, lease

    def release(self, project_id, lease):
        try:
            self.table.update_item(
                Key={"pk": f"PROJECT#{project_id}", "sk": "META"},
                UpdateExpression="SET busy_until = :zero REMOVE lease",
                ConditionExpression="lease = :lease",
                ExpressionAttributeValues={":zero": 0, ":lease": lease},
            )
        except ClientError as error:
            if not conditional(error):
                raise

    def save_turn(self, item, lease, content, result, now):
        mode_class = bool(result.source)
        artifact = (
            json.dumps(
                {"html": "", "source": result.source, "javascript": result.javascript},
                ensure_ascii=False,
            )
            if mode_class
            else result.html
        )
        html = artifact.encode("utf-8")
        if len(html) > MAX_HTML_BYTES:
            raise ValueError("Mode exceeds the HTML byte limit")
        pk = item["pk"]
        version = int(item["version"]) + 1
        chunks = [
            html[offset : offset + CHUNK_BYTES]
            for offset in range(0, len(html), CHUNK_BYTES)
        ]
        operations = [
            (
                "Update",
                {
                    "Key": {"pk": pk, "sk": "META"},
                    "UpdateExpression": (
                        "SET #version = :version, chunk_count = :chunks, "
                        "busy_until = :zero, artifact_format = :format REMOVE lease"
                    ),
                    "ConditionExpression": "lease = :lease AND busy_until > :now",
                    "ExpressionAttributeNames": {"#version": "version"},
                    "ExpressionAttributeValues": {
                        ":version": version,
                        ":chunks": len(chunks),
                        ":zero": 0,
                        ":format": "mode-class-v1" if mode_class else "html",
                        ":lease": lease,
                        ":now": now,
                    },
                },
            )
        ]
        for index, chunk in enumerate(chunks):
            operations.append(
                (
                    "Put",
                    {
                        "Item": {
                            "pk": pk,
                            "sk": f"HTML#{version:010d}#{index:04d}",
                            "data": Binary(chunk),
                        }
                    },
                )
            )
        for index in range(int(item["chunk_count"])):
            operations.append(
                (
                    "Delete",
                    {
                        "Key": {
                            "pk": pk,
                            "sk": f"HTML#{int(item['version']):010d}#{index:04d}",
                        }
                    },
                )
            )
        for index, (role, text) in enumerate(
            [("user", content), ("assistant", result.reply)]
        ):
            operations.append(
                (
                    "Put",
                    {
                        "Item": {
                            "pk": pk,
                            "sk": f"MSG#{version:010d}#{index}",
                            "version": version,
                            "role": role,
                            "content": text,
                            "created_at": now,
                        }
                    },
                )
            )
        self.transaction(operations)
