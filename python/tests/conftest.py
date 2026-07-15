import boto3
import pytest
from botocore.config import Config
from botocore.exceptions import ClientError

from db.connector import ENDPOINT_URL, REGION, TABLE_NAME, RailBackConnector

_ATTRS = [
    ("pk", "sk"),
    ("gsi1_pk", "gsi1_sk"),
    ("gsi2_pk", "gsi2_sk"),
    ("gsi_email_pending_pk", "gsi_email_pending_sk"),
    ("gsi3_pk", "gsi3_sk"),
]
_GSIS = [
    ("gsi1", "gsi1_pk", "gsi1_sk", "ALL"),
    ("gsi2", "gsi2_pk", "gsi2_sk", "KEYS_ONLY"),
    ("gsi_email_pending", "gsi_email_pending_pk", "gsi_email_pending_sk", "KEYS_ONLY"),
    ("gsi3", "gsi3_pk", "gsi3_sk", "ALL"),
]


def _ensure_table():
    """Create the single table + 4 GSIs if missing. Idempotent.

    Only runs against a local DynamoDB (DYNAMODB_ENDPOINT_URL set); against real
    AWS the table is managed by infra, so we never create/delete there.
    """
    if not ENDPOINT_URL:
        return
    client = boto3.client(
        "dynamodb",
        region_name=REGION,
        endpoint_url=ENDPOINT_URL,
        aws_access_key_id="local",
        aws_secret_access_key="local",
    )
    attr_names = {a for pair in _ATTRS for a in pair}
    try:
        client.create_table(
            TableName=TABLE_NAME,
            BillingMode="PAY_PER_REQUEST",
            AttributeDefinitions=[
                {"AttributeName": n, "AttributeType": "S"} for n in sorted(attr_names)
            ],
            KeySchema=[
                {"AttributeName": "pk", "KeyType": "HASH"},
                {"AttributeName": "sk", "KeyType": "RANGE"},
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": name,
                    "KeySchema": [
                        {"AttributeName": pk, "KeyType": "HASH"},
                        {"AttributeName": sk, "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": proj},
                }
                for name, pk, sk, proj in _GSIS
            ],
        )
        client.get_waiter("table_exists").wait(TableName=TABLE_NAME)
    except ClientError as e:
        if e.response["Error"]["Code"] != "ResourceInUseException":
            raise


@pytest.fixture(scope="session", autouse=True)
def _table():
    _ensure_table()


@pytest.fixture(scope="session")
def db():
    return RailBackConnector()


@pytest.fixture(scope="session")
def bad_db():
    cfg = Config(connect_timeout=1, read_timeout=1, retries={"max_attempts": 0})
    resource = boto3.resource(
        "dynamodb",
        region_name=REGION,
        endpoint_url="http://localhost:19999",
        aws_access_key_id="fake",
        aws_secret_access_key="fake",
        config=cfg,
    )
    return RailBackConnector(table=resource.Table(TABLE_NAME))
