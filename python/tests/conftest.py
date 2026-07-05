import boto3
import pytest
from botocore.config import Config

from db.connector import REGION, TABLE_NAME, RailBackConnector


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
