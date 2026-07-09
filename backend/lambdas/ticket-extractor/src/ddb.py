"""DDB read/write helpers for the ticket-extractor.

Two operations:
  1. `get_ticket_owner` — read the (TICKET#<id>, OWNER) row to resolve
     `ticketId → email`. The S3 event only gives us the email-*hash*
     (one-way), so this row is mandatory before we can update the parent
     UserTicket row.
  2. `update_ticket_extraction` — write the extraction result onto the
     UserTicket row at (USER#<email>, TICKET#<ticketId>). Conditional on
     the parent row's existence so we never create an orphan.

Architectural boundary: this module owns ALL DDB interaction for the
extractor Lambda. Other modules pass table-name + plain dicts.
"""

from __future__ import annotations

from typing import Any, Optional

import boto3
from botocore.exceptions import ClientError

from .keys import (
    TICKET_OWNER_SK,
    ticket_owner_pk,
    ticket_sk,
    user_pk,
)

# Module-level resource cache. Tests use _set_resource to override.
_resource: Any = None


def _get_resource() -> Any:
    """Lazy-init the module-level DynamoDB resource (high-level interface)."""
    global _resource
    if _resource is None:
        _resource = boto3.resource("dynamodb")
    return _resource


def _set_resource(resource: Any) -> None:
    """Test seam — DI override of the module-level DDB resource."""
    global _resource
    _resource = resource


def get_ticket_owner(
    table_name: str,
    ticketId: str,
    *,
    client: Optional[Any] = None,
) -> Optional[dict]:
    """GetItem on (TICKET#<ticketId>, OWNER).

    Returns the raw item dict (containing at least `email`) or None when
    the row does not exist.

    Args:
        table_name: DDB table name.
        ticketId: the ticket identifier (no prefix — keys.ticket_owner_pk
            applies the `TICKET#` prefix).
        client: optional boto3 DynamoDB *resource* (NOT a low-level
            client) for DI. Defaults to module-level cached resource.

    The `client` kwarg is named for API consistency with `s3.fetch_bytes`,
    but DDB callers must pass a `boto3.resource("dynamodb")` instance —
    we use the high-level Table interface here.
    """
    r = client if client is not None else _get_resource()
    table = r.Table(table_name)

    response = table.get_item(
        Key={
            "pk": ticket_owner_pk(ticketId),
            "sk": TICKET_OWNER_SK,
        }
    )
    return response.get("Item")


def update_ticket_extraction(
    table_name: str,
    email: str,
    ticketId: str,
    fields: dict,
    *,
    condition_required: bool = True,
    remove_fields: Optional[list] = None,
    appends: Optional[dict] = None,
    extra_condition: Optional[str] = None,
    extra_condition_values: Optional[dict] = None,
    extra_condition_names: Optional[dict] = None,
    client: Optional[Any] = None,
) -> bool:
    """UpdateItem on (USER#<email>, TICKET#<ticketId>) — set extraction fields.

    Builds an UpdateExpression dynamically from `fields`. Every field name
    is aliased through ExpressionAttributeNames (`#fN`) to side-step DDB's
    long list of reserved words (status, name, etc.) without per-field
    decisions.

    Args:
        table_name: DDB table name.
        email: user email (will be normalised by `user_pk`).
        ticketId: the ticket id.
        fields: a dict of `{ attribute_name: value }`. Empty dict + no
            remove_fields/appends = no-op (returns True without an API call).
        condition_required: when True (default), wraps the UpdateItem in
            `attribute_exists(PK) AND attribute_exists(SK)` so we never
            accidentally create an orphan row. The caller treats a False
            return as "parent ticket was deleted/anonymised — drop the
            extraction result and move on".
        remove_fields: optional list of attribute names to REMOVE from
            the row (used to clear stale GSI2 keys when an earlier
            BARCODE row regresses to MANUAL/PDF_TEXT/FAILED).
        appends: optional dict `{attribute: list_of_items}` — each entry
            generates a `list_append(if_not_exists(attr, :empty), :val)`
            clause. Used by callers that need to append to `state_timeline`.
        extra_condition: optional additional ConditionExpression fragment
            joined with `AND`. Used e.g. to require
            `extraction_status = "PROCESSING"` for state-machine
            transitions.
        extra_condition_values: optional dict of `{":alias": value}`
            entries referenced by `extra_condition`.

    Returns:
        True on a successful update. False when `condition_required` was
        True AND the conditional check failed (parent row does not
        exist OR extra_condition failed). All other ClientErrors propagate.
    """
    remove_fields = remove_fields or []
    appends = appends or {}

    if not fields and not remove_fields and not appends:
        return True

    r = client if client is not None else _get_resource()
    table = r.Table(table_name)

    set_clauses: list[str] = []
    expr_names: dict[str, str] = {
        "#PK": "pk",
        "#SK": "sk",
    }
    expr_values: dict[str, Any] = {}

    for i, (name, value) in enumerate(fields.items()):
        alias_name = f"#f{i}"
        alias_value = f":v{i}"
        expr_names[alias_name] = name
        expr_values[alias_value] = value
        set_clauses.append(f"{alias_name} = {alias_value}")

    # list_append clauses for any `appends` entries.
    for j, (name, value) in enumerate(appends.items()):
        alias_name = f"#a{j}"
        alias_value = f":a{j}"
        empty_alias = f":empty{j}"
        expr_names[alias_name] = name
        expr_values[alias_value] = value
        expr_values[empty_alias] = []
        set_clauses.append(
            f"{alias_name} = list_append(if_not_exists({alias_name}, {empty_alias}), {alias_value})"
        )

    remove_clauses: list[str] = []
    for k, name in enumerate(remove_fields):
        alias_name = f"#r{k}"
        expr_names[alias_name] = name
        remove_clauses.append(alias_name)

    parts: list[str] = []
    if set_clauses:
        parts.append("SET " + ", ".join(set_clauses))
    if remove_clauses:
        parts.append("REMOVE " + ", ".join(remove_clauses))

    update_expression = " ".join(parts)

    kwargs: dict[str, Any] = {
        "Key": {
            "pk": user_pk(email),
            "sk": ticket_sk(ticketId),
        },
        "UpdateExpression": update_expression,
        "ExpressionAttributeNames": expr_names,
    }
    if expr_values:
        kwargs["ExpressionAttributeValues"] = expr_values

    condition_parts: list[str] = []
    if condition_required:
        condition_parts.append("attribute_exists(#PK) AND attribute_exists(#SK)")
    if extra_condition:
        condition_parts.append(extra_condition)
    if condition_parts:
        # DDB ValidationException trips on redundant parentheses, so we
        # only wrap each part in parens when there is more than one.
        if len(condition_parts) == 1:
            kwargs["ConditionExpression"] = condition_parts[0]
        else:
            kwargs["ConditionExpression"] = " AND ".join(
                f"({c})" for c in condition_parts
            )

    if extra_condition_values:
        # Merge into ExpressionAttributeValues; caller must not collide
        # with reserved aliases (we use #fN/:vN/#rN/#aN/:aN/:emptyN).
        merged = dict(kwargs.get("ExpressionAttributeValues") or {})
        merged.update(extra_condition_values)
        kwargs["ExpressionAttributeValues"] = merged

    if extra_condition_names:
        # Merge into ExpressionAttributeNames so the caller can reference
        # attributes by a stable manual alias (e.g. `#extraction_status`)
        # in `extra_condition` without coupling to the helper's internal
        # `#fN` numbering scheme.
        kwargs["ExpressionAttributeNames"] = {
            **kwargs["ExpressionAttributeNames"],
            **extra_condition_names,
        }

    try:
        table.update_item(**kwargs)
        return True
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        raise
