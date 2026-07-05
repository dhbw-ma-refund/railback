from __future__ import annotations

import os

import boto3
from boto3.dynamodb.conditions import Key

from db.base import BaseConnector, ConflictError, Ok, Result

TABLE_NAME = os.environ.get("RAILBACK_DDB_TABLE", "RailBack")
REGION = "eu-north-1"
ENDPOINT_URL = os.environ.get("DYNAMODB_ENDPOINT_URL", None)

_ADMIN_STRIPPED_FIELDS = frozenset({"iban_enc", "bic_enc"})


def _is_plain_ticket_sk(sk: str) -> bool:
    return sk.startswith("TICKET#") and "#" not in sk[len("TICKET#"):]


def _table_resource(table=None):
    if table is not None:
        return table
    kwargs = {}
    if ENDPOINT_URL:
        kwargs["endpoint_url"] = ENDPOINT_URL
        kwargs["aws_access_key_id"] = "fake"
        kwargs["aws_secret_access_key"] = "fake"
    ddb = boto3.resource("dynamodb", region_name=REGION, **kwargs)
    return ddb.Table(TABLE_NAME)


# ---------------------------------------------------------------------------
# User  —  pk=USER#{email}  sk=PROFILE
# ---------------------------------------------------------------------------

class UserConnector(BaseConnector):
    def get(self, email: str) -> Result:
        return self._get(f"USER#{email}", "PROFILE")

    def get_for_admin(self, email: str) -> Result:
        result = self._get(f"USER#{email}", "PROFILE")
        if result.is_err():
            return result
        item = result.unwrap()
        if item:
            item = {k: v for k, v in item.items() if k not in _ADMIN_STRIPPED_FIELDS}
        return Ok(item)

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, email: str, updates: dict) -> Result:
        return self._update_fields(f"USER#{email}", "PROFILE", updates)

    def list_all(self, limit: int | None = None) -> Result:
        return self._query(IndexName="gsi1", KeyConditionExpression=Key("gsi1_pk").eq("USER"), **({"Limit": limit} if limit is not None else {}))


# ---------------------------------------------------------------------------
# Admin  —  pk=ADMIN#{email}  sk=PROFILE
# ---------------------------------------------------------------------------

class AdminConnector(BaseConnector):
    def get(self, email: str) -> Result:
        return self._get(f"ADMIN#{email}", "PROFILE")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, email: str, updates: dict) -> Result:
        return self._update_fields(f"ADMIN#{email}", "PROFILE", updates)

    def list_all(self, limit: int | None = None) -> Result:
        return self._query(IndexName="gsi1", KeyConditionExpression=Key("gsi1_pk").eq("ADMIN"), **({"Limit": limit} if limit is not None else {}))


# ---------------------------------------------------------------------------
# Ticket  —  pk=USER#{email}  sk=TICKET#{ticket_id}
# ---------------------------------------------------------------------------

class TicketConnector(BaseConnector):
    def get(self, email: str, ticket_id: str) -> Result:
        return self._get(f"USER#{email}", f"TICKET#{ticket_id}")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, email: str, ticket_id: str, updates: dict) -> Result:
        return self._update_fields(f"USER#{email}", f"TICKET#{ticket_id}", updates)

    def list_for_user(self, email: str, limit: int | None = None) -> Result:
        result = self._query(
            KeyConditionExpression=Key("pk").eq(f"USER#{email}") & Key("sk").begins_with("TICKET#"),
        )
        if result.is_err():
            return result
        items = [i for i in result.unwrap() if _is_plain_ticket_sk(i["sk"])]
        return Ok(items[:limit] if limit is not None else items)

    def get_by_train(self, train_nr: str, date: str, limit: int | None = None) -> Result:
        return self._query(
            IndexName="gsi1",
            KeyConditionExpression=Key("gsi1_pk").eq(f"TRAIN#{train_nr}#{date}"),
            **({"Limit": limit} if limit is not None else {}),
        )

    def check_barcode_duplicate(self, barcode_uid: str) -> Result:
        result = self._query(
            IndexName="gsi2",
            KeyConditionExpression=Key("gsi2_pk").eq("BARCODE") & Key("gsi2_sk").eq(barcode_uid),
            Limit=1,
        )
        if result.is_err():
            return result
        items = result.unwrap()
        return Ok(items[0] if items else None)

    def list_email_pending(self, limit: int) -> Result:
        return self._query(
            IndexName="gsi_email_pending",
            KeyConditionExpression=Key("gsi_email_pending_pk").eq("EMAIL_PENDING"),
            ScanIndexForward=True,
            Limit=limit,
        )


# ---------------------------------------------------------------------------
# TicketOwner  —  pk=TICKET#{ticket_id}  sk=OWNER
# ---------------------------------------------------------------------------

class TicketOwnerConnector(BaseConnector):
    def get(self, ticket_id: str) -> Result:
        return self._get(f"TICKET#{ticket_id}", "OWNER")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, ticket_id: str, updates: dict) -> Result:
        return self._update_fields(f"TICKET#{ticket_id}", "OWNER", updates)


# ---------------------------------------------------------------------------
# RawUpload  —  pk=USER#{email}  sk=RAW#{ticket_id}
# ---------------------------------------------------------------------------

class RawUploadConnector(BaseConnector):
    def get(self, email: str, ticket_id: str) -> Result:
        return self._get(f"USER#{email}", f"RAW#{ticket_id}")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, email: str, ticket_id: str, updates: dict) -> Result:
        return self._update_fields(f"USER#{email}", f"RAW#{ticket_id}", updates)


# ---------------------------------------------------------------------------
# RenderedPdf  —  pk=USER#{email}  sk=RENDERED#{ticket_id}
# ---------------------------------------------------------------------------

class RenderedPdfConnector(BaseConnector):
    def get(self, email: str, ticket_id: str) -> Result:
        return self._get(f"USER#{email}", f"RENDERED#{ticket_id}")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, email: str, ticket_id: str, updates: dict) -> Result:
        return self._update_fields(f"USER#{email}", f"RENDERED#{ticket_id}", updates)


# ---------------------------------------------------------------------------
# OriginalReceipt  —  pk=USER#{email}  sk=TICKET#{ticket_id}#BELEG#{beleg_id}
# ---------------------------------------------------------------------------

class OriginalReceiptConnector(BaseConnector):
    def get(self, email: str, ticket_id: str, beleg_id: str) -> Result:
        return self._get(f"USER#{email}", f"TICKET#{ticket_id}#BELEG#{beleg_id}")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, email: str, ticket_id: str, beleg_id: str, updates: dict) -> Result:
        return self._update_fields(f"USER#{email}", f"TICKET#{ticket_id}#BELEG#{beleg_id}", updates)

    def list_for_ticket(self, email: str, ticket_id: str, limit: int | None = None) -> Result:
        return self._query(
            KeyConditionExpression=Key("pk").eq(f"USER#{email}") & Key("sk").begins_with(f"TICKET#{ticket_id}#BELEG#"),
            **({"Limit": limit} if limit is not None else {}),
        )


# ---------------------------------------------------------------------------
# SepaMandate  —  pk=USER#{email}  sk=TICKET#{ticket_id}#MANDATE
# ---------------------------------------------------------------------------

class SepaMandateConnector(BaseConnector):
    def get(self, email: str, ticket_id: str) -> Result:
        return self._get(f"USER#{email}", f"TICKET#{ticket_id}#MANDATE")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, email: str, ticket_id: str, updates: dict) -> Result:
        return self._update_fields(f"USER#{email}", f"TICKET#{ticket_id}#MANDATE", updates)

    def stamp_pain008_built(self, email: str, ticket_id: str, batch_id: str, s3_key: str, built_at: str) -> Result:
        return self._update_if(
            f"USER#{email}", f"TICKET#{ticket_id}#MANDATE",
            {"pain008_built_at": built_at, "pain008_batch_id": batch_id, "pain008_s3_key": s3_key},
            "attribute_exists(pk) AND attribute_not_exists(pain008_built_at)",
        )


# ---------------------------------------------------------------------------
# SepaReport  —  pk=SEPA#REPORT#{date}  sk=REPORT#{report_id}
# ---------------------------------------------------------------------------

class SepaReportConnector(BaseConnector):
    def get(self, date: str, report_id: str) -> Result:
        return self._get(f"SEPA#REPORT#{date}", f"REPORT#{report_id}")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, date: str, report_id: str, updates: dict) -> Result:
        return self._update_fields(f"SEPA#REPORT#{date}", f"REPORT#{report_id}", updates)

    def list_by_date(self, date: str, limit: int | None = None) -> Result:
        return self._query(KeyConditionExpression=Key("pk").eq(f"SEPA#REPORT#{date}"), **({"Limit": limit} if limit is not None else {}))


# ---------------------------------------------------------------------------
# TrainSegmentDelay  —  pk=TRAIN#{train_nr}#{date}  sk=SEG#{seg_id}
# ---------------------------------------------------------------------------

class TrainSegmentDelayConnector(BaseConnector):
    def get(self, train_nr: str, date: str, seg_id: str) -> Result:
        return self._get(f"TRAIN#{train_nr}#{date}", f"SEG#{seg_id}")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, train_nr: str, date: str, seg_id: str, updates: dict) -> Result:
        return self._update_fields(f"TRAIN#{train_nr}#{date}", f"SEG#{seg_id}", updates)

    def list_for_train(self, train_nr: str, date: str, limit: int | None = None) -> Result:
        return self._query(
            KeyConditionExpression=Key("pk").eq(f"TRAIN#{train_nr}#{date}") & Key("sk").begins_with("SEG#"),
            **({"Limit": limit} if limit is not None else {}),
        )

    def route_lookup(self, origin_eva: int, date: str, from_time: str, to_time: str, limit: int | None = None) -> Result:
        return self._query(
            IndexName="gsi1",
            KeyConditionExpression=Key("gsi1_pk").eq(f"STATION#{origin_eva}#{date}") & Key("gsi1_sk").between(from_time, to_time + "￿"),
            **({"Limit": limit} if limit is not None else {}),
        )


# ---------------------------------------------------------------------------
# RouteTemplate  —  pk=USER#{email}  sk=TEMPLATE#{template_id}
# ---------------------------------------------------------------------------

class RouteTemplateConnector(BaseConnector):
    def get(self, email: str, template_id: str) -> Result:
        return self._get(f"USER#{email}", f"TEMPLATE#{template_id}")

    def put(self, item: dict) -> Result:
        return self._put(item)

    def update(self, email: str, template_id: str, updates: dict) -> Result:
        return self._update_fields(f"USER#{email}", f"TEMPLATE#{template_id}", updates)

    def list_for_user(self, email: str, limit: int | None = None) -> Result:
        return self._query(
            KeyConditionExpression=Key("pk").eq(f"USER#{email}") & Key("sk").begins_with("TEMPLATE#"),
            **({"Limit": limit} if limit is not None else {}),
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

    def delete_user(self, email: str) -> Result:
        all_items = self.user._query(KeyConditionExpression=Key("pk").eq(f"USER#{email}"))
        if all_items.is_err():
            return all_items
        items = all_items.unwrap()
        keys = [(item["pk"], item["sk"]) for item in items]
        for item in items:
            sk = item["sk"]
            if _is_plain_ticket_sk(sk):
                keys.append((f"TICKET#{sk[len('TICKET#'):]}", "OWNER"))
        return self.user._batch_delete(keys)

    def delete_ticket(self, email: str, ticket_id: str) -> Result:
        children = self.ticket._query(
            KeyConditionExpression=Key("pk").eq(f"USER#{email}") & Key("sk").begins_with(f"TICKET#{ticket_id}#")
        )
        if children.is_err():
            return children
        keys = [(item["pk"], item["sk"]) for item in children.unwrap()]
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
