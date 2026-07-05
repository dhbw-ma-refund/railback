from __future__ import annotations

import functools
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Generic, TypeVar

from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

T = TypeVar("T")


class Result(ABC):
    @abstractmethod
    def is_ok(self) -> bool: ...

    @abstractmethod
    def is_err(self) -> bool: ...

    @abstractmethod
    def unwrap(self): ...


@dataclass(frozen=True)
class Ok(Result, Generic[T]):
    value: T

    def is_ok(self) -> bool:
        return True

    def is_err(self) -> bool:
        return False

    def unwrap(self) -> T:
        return self.value


@dataclass(frozen=True)
class Err(Result):
    error: Exception

    def is_ok(self) -> bool:
        return False

    def is_err(self) -> bool:
        return True

    def unwrap(self):
        raise self.error


class ConflictError(Exception):
    pass


def safe(method):
    @functools.wraps(method)
    def wrapper(*args, **kwargs):
        try:
            return method(*args, **kwargs)
        except ClientError as exc:
            code = exc.response["Error"]["Code"]
            msg = exc.response["Error"]["Message"]
            logger.warning(f"{method.__qualname__} — {code}: {msg}")
            return Err(exc)
        except Exception as exc:
            logger.error(f"{method.__qualname__} — unexpected: {exc}")
            return Err(exc)
    return wrapper


class BaseConnector:
    def __init__(self, table):
        self._t = table

    @safe
    def _get(self, pk: str, sk: str) -> Result:
        resp = self._t.get_item(Key={"pk": pk, "sk": sk})
        return Ok(resp.get("Item"))

    @safe
    def _put(self, item: dict, **kwargs) -> Result:
        self._t.put_item(Item=item, **kwargs)
        return Ok(None)

    @safe
    def _update_fields(self, pk: str, sk: str, updates: dict) -> Result:
        if not updates:
            return Ok(None)
        set_parts, names, values = [], {}, {}
        for i, (k, v) in enumerate(updates.items()):
            ph_n, ph_v = f"#f{i}", f":v{i}"
            set_parts.append(f"{ph_n} = {ph_v}")
            names[ph_n] = k
            values[ph_v] = v
        self._t.update_item(
            Key={"pk": pk, "sk": sk},
            UpdateExpression="SET " + ", ".join(set_parts),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
        return Ok(None)

    def _update_if(self, pk: str, sk: str, updates: dict, condition: str) -> Result:
        if not updates:
            raise ValueError("_update_if requires non-empty updates")
        set_parts, names, values = [], {}, {}
        for i, (k, v) in enumerate(updates.items()):
            ph_n, ph_v = f"#f{i}", f":v{i}"
            set_parts.append(f"{ph_n} = {ph_v}")
            names[ph_n] = k
            values[ph_v] = v
        try:
            self._t.update_item(
                Key={"pk": pk, "sk": sk},
                UpdateExpression="SET " + ", ".join(set_parts),
                ConditionExpression=condition,
                ExpressionAttributeNames=names,
                ExpressionAttributeValues=values,
            )
            return Ok(None)
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return Err(ConflictError(f"condition failed on ({pk}, {sk})"))
            logger.warning(f"_update_if — {exc.response['Error']['Code']}: {exc.response['Error']['Message']}")
            return Err(exc)
        except Exception as exc:
            logger.error(f"_update_if — unexpected: {exc}")
            return Err(exc)

    @safe
    def _delete(self, pk: str, sk: str) -> Result:
        self._t.delete_item(Key={"pk": pk, "sk": sk})
        return Ok(None)

    @safe
    def _query(self, **kwargs) -> Result:
        items = []
        limit = kwargs.get("Limit")
        while True:
            resp = self._t.query(**kwargs)
            items.extend(resp.get("Items", []))
            last = resp.get("LastEvaluatedKey")
            if limit is not None and len(items) >= limit:
                return Ok(items[:limit])
            if not last:
                break
            kwargs["ExclusiveStartKey"] = last
            if limit is not None:
                kwargs["Limit"] = limit - len(items)
        return Ok(items)

    @safe
    def _batch_delete(self, keys: list[tuple[str, str]]) -> Result:
        with self._t.batch_writer() as batch:
            for pk, sk in dict.fromkeys(keys):
                batch.delete_item(Key={"pk": pk, "sk": sk})
        return Ok(None)
