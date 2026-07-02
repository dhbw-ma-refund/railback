"""
RailBack DynamoDB connectors.

One connector class per entity, each exposing basic CRUD:
  get, put, update, delete.

All methods return Result — callers must handle errors explicitly.
"""

from __future__ import annotations

import os

import boto3
from boto3.dynamodb.conditions import Key

from db.base import BaseConnector, Ok, Result, safe

TABLE_NAME = os.environ.get("RAILBACK_DDB_TABLE", "railback")
ENDPOINT_URL = os.environ.get("DYNAMODB_ENDPOINT_URL", None)


def _table_resource(table=None):
    if table is not None:
        return table
    kwargs = {}
    if ENDPOINT_URL:
        kwargs["endpoint_url"] = ENDPOINT_URL
    ddb = boto3.resource("dynamodb", region_name="eu-central-1", **kwargs)
    return ddb.Table(TABLE_NAME)


# ---------------------------------------------------------------------------
# User  —  PK=USER#{email}  SK=PROFILE
# ---------------------------------------------------------------------------

class UserConnector(BaseConnector):
    def get(self, email: str) -> Result:
        return self._get(f"USER#{email}", "PROFILE")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, email: str, updates: dict) -> Result:
        return self._update_fields(f"USER#{email}", "PROFILE", updates)

    def list_all(self) -> Result:
        """Ok(list[dict]) — all users via GSI1."""
        return self._query(IndexName="GSI1", KeyConditionExpression=Key("GSI1_PK").eq("USER"))


# ---------------------------------------------------------------------------
# Admin  —  PK=ADMIN#{email}  SK=PROFILE
# ---------------------------------------------------------------------------

class AdminConnector(BaseConnector):
    def get(self, email: str) -> Result:
        return self._get(f"ADMIN#{email}", "PROFILE")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, email: str, updates: dict) -> Result:
        return self._update_fields(f"ADMIN#{email}", "PROFILE", updates)

    def list_all(self) -> Result:
        """Ok(list[dict]) — all admins via GSI1."""
        return self._query(IndexName="GSI1", KeyConditionExpression=Key("GSI1_PK").eq("ADMIN"))


# ---------------------------------------------------------------------------
# Ticket  —  PK=USER#{email}  SK=TICKET#{ticket_id}
# ---------------------------------------------------------------------------

class TicketConnector(BaseConnector):
    def get(self, email: str, ticket_id: str) -> Result:
        return self._get(f"USER#{email}", f"TICKET#{ticket_id}")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, email: str, ticket_id: str, updates: dict) -> Result:
        return self._update_fields(f"USER#{email}", f"TICKET#{ticket_id}", updates)

    def list_for_user(self, email: str) -> Result:
        """Ok(list[dict]) — tickets only, excludes receipt and mandate rows."""
        result = self._query(
            KeyConditionExpression=Key("PK").eq(f"USER#{email}") & Key("SK").begins_with("TICKET#"),
        )
        if result.is_err():
            return result
        return Ok([i for i in result.unwrap() if "#BELEG#" not in i["SK"] and not i["SK"].endswith("#MANDATE")])

    def get_by_train(self, train_nr: str, date: str) -> Result:
        """Ok(list[dict]) — all tickets for a train on a date via GSI1."""
        return self._query(
            IndexName="GSI1",
            KeyConditionExpression=Key("GSI1_PK").eq(f"TRAIN#{train_nr}#{date}"),
        )

    def check_barcode_duplicate(self, barcode_uid: str) -> Result:
        """Ok(item | None) — item present means duplicate, via GSI2."""
        result = self._query(
            IndexName="GSI2",
            KeyConditionExpression=Key("GSI2_PK").eq("BARCODE") & Key("GSI2_SK").eq(barcode_uid),
            Limit=1,
        )
        if result.is_err():
            return result
        items = result.unwrap()
        return Ok(items[0] if items else None)

    def list_email_pending(self) -> Result:
        """Ok(list[dict]) ordered oldest-first via GSI_EMAIL_PENDING."""
        return self._query(
            IndexName="GSI_EMAIL_PENDING",
            KeyConditionExpression=Key("GSI_EMAIL_PENDING_PK").eq("EMAIL_PENDING"),
            ScanIndexForward=True,
        )


# ---------------------------------------------------------------------------
# TicketOwner  —  PK=TICKET#{ticket_id}  SK=OWNER
# ---------------------------------------------------------------------------

class TicketOwnerConnector(BaseConnector):
    def get(self, ticket_id: str) -> Result:
        return self._get(f"TICKET#{ticket_id}", "OWNER")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, ticket_id: str, updates: dict) -> Result:
        return self._update_fields(f"TICKET#{ticket_id}", "OWNER", updates)


# ---------------------------------------------------------------------------
# RawUpload  —  PK=USER#{email}  SK=RAW#{ticket_id}
# ---------------------------------------------------------------------------

class RawUploadConnector(BaseConnector):
    def get(self, email: str, ticket_id: str) -> Result:
        return self._get(f"USER#{email}", f"RAW#{ticket_id}")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, email: str, ticket_id: str, updates: dict) -> Result:
        return self._update_fields(f"USER#{email}", f"RAW#{ticket_id}", updates)


# ---------------------------------------------------------------------------
# RenderedPdf  —  PK=USER#{email}  SK=RENDERED#{ticket_id}
# ---------------------------------------------------------------------------

class RenderedPdfConnector(BaseConnector):
    def get(self, email: str, ticket_id: str) -> Result:
        return self._get(f"USER#{email}", f"RENDERED#{ticket_id}")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, email: str, ticket_id: str, updates: dict) -> Result:
        return self._update_fields(f"USER#{email}", f"RENDERED#{ticket_id}", updates)


# ---------------------------------------------------------------------------
# OriginalReceipt  —  PK=USER#{email}  SK=TICKET#{ticket_id}#BELEG#{beleg_id}
# ---------------------------------------------------------------------------

class OriginalReceiptConnector(BaseConnector):
    def get(self, email: str, ticket_id: str, beleg_id: str) -> Result:
        return self._get(f"USER#{email}", f"TICKET#{ticket_id}#BELEG#{beleg_id}")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, email: str, ticket_id: str, beleg_id: str, updates: dict) -> Result:
        return self._update_fields(f"USER#{email}", f"TICKET#{ticket_id}#BELEG#{beleg_id}", updates)

    def list_for_ticket(self, email: str, ticket_id: str) -> Result:
        """Ok(list[dict]) — all receipts for a ticket."""
        return self._query(
            KeyConditionExpression=Key("PK").eq(f"USER#{email}") & Key("SK").begins_with(f"TICKET#{ticket_id}#BELEG#"),
        )


# ---------------------------------------------------------------------------
# SepaMandate  —  PK=USER#{email}  SK=TICKET#{ticket_id}#MANDATE
# ---------------------------------------------------------------------------

class SepaMandateConnector(BaseConnector):
    def get(self, email: str, ticket_id: str) -> Result:
        return self._get(f"USER#{email}", f"TICKET#{ticket_id}#MANDATE")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, email: str, ticket_id: str, updates: dict) -> Result:
        return self._update_fields(f"USER#{email}", f"TICKET#{ticket_id}#MANDATE", updates)


# ---------------------------------------------------------------------------
# SepaReport  —  PK=SEPA#REPORT#{date}  SK=REPORT#{report_id}
# ---------------------------------------------------------------------------

class SepaReportConnector(BaseConnector):
    def get(self, date: str, report_id: str) -> Result:
        return self._get(f"SEPA#REPORT#{date}", f"REPORT#{report_id}")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, date: str, report_id: str, updates: dict) -> Result:
        return self._update_fields(f"SEPA#REPORT#{date}", f"REPORT#{report_id}", updates)

    def list_by_date(self, date: str) -> Result:
        """Ok(list[dict]) — all reports for a given date."""
        return self._query(KeyConditionExpression=Key("PK").eq(f"SEPA#REPORT#{date}"))


# ---------------------------------------------------------------------------
# TrainSegmentDelay  —  PK=TRAIN#{train_nr}#{date}  SK=SEG#{seg_id}
# ---------------------------------------------------------------------------

class TrainSegmentDelayConnector(BaseConnector):
    def get(self, train_nr: str, date: str, seg_id: str) -> Result:
        return self._get(f"TRAIN#{train_nr}#{date}", f"SEG#{seg_id}")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, train_nr: str, date: str, seg_id: str, updates: dict) -> Result:
        return self._update_fields(f"TRAIN#{train_nr}#{date}", f"SEG#{seg_id}", updates)

    def list_for_train(self, train_nr: str, date: str) -> Result:
        """Ok(list[dict]) — all segments for a train on a date."""
        return self._query(
            KeyConditionExpression=Key("PK").eq(f"TRAIN#{train_nr}#{date}") & Key("SK").begins_with("SEG#"),
        )

    def route_lookup(self, origin_eva: int, date: str, from_time: str, to_time: str) -> Result:
        """Ok(list[dict]) — segments departing from a station within a time range via GSI3."""
        return self._query(
            IndexName="GSI3",
            KeyConditionExpression=Key("GSI3_PK").eq(f"STATION#{origin_eva}#{date}") & Key("GSI3_SK").between(from_time, to_time),
        )


# ---------------------------------------------------------------------------
# RouteTemplate  —  PK=USER#{email}  SK=TEMPLATE#{template_id}
# ---------------------------------------------------------------------------

class RouteTemplateConnector(BaseConnector):
    def get(self, email: str, template_id: str) -> Result:
        return self._get(f"USER#{email}", f"TEMPLATE#{template_id}")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, email: str, template_id: str, updates: dict) -> Result:
        return self._update_fields(f"USER#{email}", f"TEMPLATE#{template_id}", updates)

    def list_for_user(self, email: str) -> Result:
        """Ok(list[dict]) — all templates for a user."""
        return self._query(
            KeyConditionExpression=Key("PK").eq(f"USER#{email}") & Key("SK").begins_with("TEMPLATE#"),
        )


# ---------------------------------------------------------------------------
# Root connector
# ---------------------------------------------------------------------------

class RailBackConnector:
    def __init__(self, table=None):
        self._table = _table_resource(table)
        self.user = UserConnector(self._table)
        self.admin = AdminConnector(self._table)
        self.ticket = TicketConnector(self._table)
        self.ticket_owner = TicketOwnerConnector(self._table)
        self.raw_upload = RawUploadConnector(self._table)
        self.rendered_pdf = RenderedPdfConnector(self._table)
        self.receipt = OriginalReceiptConnector(self._table)
        self.mandate = SepaMandateConnector(self._table)
        self.sepa_report = SepaReportConnector(self._table)
        self.train_delay = TrainSegmentDelayConnector(self._table)
        self.route_template = RouteTemplateConnector(self._table)

    @safe
    def delete_user(self, email: str) -> Result:
        """Delete a user and everything under their partition, plus all TicketOwner records."""
        all_items = self.user._query(KeyConditionExpression=Key("PK").eq(f"USER#{email}"))
        if all_items.is_err():
            return all_items

        items = all_items.unwrap()
        keys = [(item["PK"], item["SK"]) for item in items]

        for item in items:
            sk = item["SK"]
            if sk.startswith("TICKET#") and sk.count("#") == 1:
                ticket_id = sk.removeprefix("TICKET#")
                keys.append((f"TICKET#{ticket_id}", "OWNER"))

        return self.user._batch_delete(keys)

    @safe
    def delete_ticket(self, email: str, ticket_id: str) -> Result:
        """Delete a ticket and all its owned items: receipts, mandate, owner, raw upload, rendered pdf."""
        # Trailing # prevents prefix collision with ticket IDs that share a prefix (e.g. "abc" vs "abcd")
        children = self.ticket._query(
            KeyConditionExpression=Key("PK").eq(f"USER#{email}") & Key("SK").begins_with(f"TICKET#{ticket_id}#")
        )
        if children.is_err():
            return children

        keys = [(item["PK"], item["SK"]) for item in children.unwrap()]
        keys += [
            (f"USER#{email}", f"TICKET#{ticket_id}"),
            (f"TICKET#{ticket_id}", "OWNER"),
            (f"USER#{email}", f"RAW#{ticket_id}"),
            (f"USER#{email}", f"RENDERED#{ticket_id}"),
        ]
        return self.ticket._batch_delete(keys)

    def delete_admin(self, email: str) -> Result:
        return self.admin._delete(f"ADMIN#{email}", "PROFILE")

    def delete_ticket_owner(self, ticket_id: str) -> Result:
        return self.ticket_owner._delete(f"TICKET#{ticket_id}", "OWNER")

    def delete_raw_upload(self, email: str, ticket_id: str) -> Result:
        return self.raw_upload._delete(f"USER#{email}", f"RAW#{ticket_id}")

    def delete_rendered_pdf(self, email: str, ticket_id: str) -> Result:
        return self.rendered_pdf._delete(f"USER#{email}", f"RENDERED#{ticket_id}")

    def delete_receipt(self, email: str, ticket_id: str, beleg_id: str) -> Result:
        return self.receipt._delete(f"USER#{email}", f"TICKET#{ticket_id}#BELEG#{beleg_id}")

    def delete_mandate(self, email: str, ticket_id: str) -> Result:
        return self.mandate._delete(f"USER#{email}", f"TICKET#{ticket_id}#MANDATE")

    def delete_sepa_report(self, date: str, report_id: str) -> Result:
        return self.sepa_report._delete(f"SEPA#REPORT#{date}", f"REPORT#{report_id}")

    def delete_train_delay(self, train_nr: str, date: str, seg_id: str) -> Result:
        return self.train_delay._delete(f"TRAIN#{train_nr}#{date}", f"SEG#{seg_id}")

    def delete_route_template(self, email: str, template_id: str) -> Result:
        return self.route_template._delete(f"USER#{email}", f"TEMPLATE#{template_id}")
