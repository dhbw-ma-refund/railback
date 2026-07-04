"""Pydantic v2 models for the ticket-extractor.

These mirror the zod schemas in `@railback/lib` (TypeScript) — the canonical
authority is `railback/backend/schema/` per the project convention that the
Node and Python sides intentionally re-implement schema independently.

Authoritative DDB item shapes live in `DB_SCHEMA.md` at the project root.
Whenever the UserTicket extraction fields change there, update this file.

Models:
    - ExtractionMethod  (Literal alias)
    - ExtractionStatus  (Literal alias)
    - ExtractionResult  — produced by run_cascade(); persisted by persist.py.
    - TicketOwner       — type-only view of the TicketOwner DDB row.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Type aliases — mirror the zod unions in @railback/lib
# ---------------------------------------------------------------------------

ExtractionMethod = Literal["BARCODE", "PDF_TEXT", "MANUAL", "MANUAL_ROUTE"]
"""How a ticket's metadata was obtained.

- BARCODE: Aztec barcode decoded + parsed via UIC 918.3 (confidence 1.0)
- PDF_TEXT: PDF text-layer regex (confidence 0.95)
- MANUAL: user filled the wizard by hand (confidence 0.0)
- MANUAL_ROUTE: route-template flow, no file ever uploaded (confidence 0.0)
"""

ExtractionStatus = Literal["PROCESSING", "DONE", "FAILED"]
"""Frontend-visible polling status.

- PROCESSING: extractor not yet finished (initial row state)
- DONE: extractor wrote its result
- FAILED: extractor crashed unrecoverably; user must MANUAL-fallback in UI
"""


# ---------------------------------------------------------------------------
# ExtractionResult — the output of the cascade
# ---------------------------------------------------------------------------


class ExtractionResult(BaseModel):
    """Result of one extraction cascade run.

    MANUAL results carry only `method` + `confidence` (all other fields None).
    BARCODE results MUST carry `barcode_uid` (used for duplicate-detection
    via GSI2). PDF_TEXT and BARCODE both populate the `fahrt_*` fields where
    the source data is present; missing fields stay None — never empty
    string.
    """

    # `extra="ignore"`: we splat the vendored UIC-918.3 parser's dict
    # straight into the constructor. If the upstream `onlineticket.py`
    # adds a new field in a future vendor-update, we want a forward-
    # compatible fallthrough (silently drop the unknown key) rather than
    # have pydantic raise and the cascade misclassify a real BARCODE
    # ticket as PDF_TEXT/MANUAL. The uic_918_3 wrapper is the
    # field-allowlist gate; this layer trusts it.
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=False)

    method: ExtractionMethod
    confidence: float = Field(ge=0.0, le=1.0)

    # BARCODE-only — UIC 918.3 ticket UID, used for duplicate detection
    barcode_uid: Optional[str] = None

    # Person fields — present on most BARCODE tickets, sometimes on PDF_TEXT
    vorname_aus_ticket: Optional[str] = None
    nachname_aus_ticket: Optional[str] = None

    # Trip fields — naming mirrors DB_SCHEMA.md exactly
    fahrt_abreisedatum: Optional[str] = None
    fahrt_abreisebahnhof: Optional[str] = None
    fahrt_zielbahnhof: Optional[str] = None
    fahrt_abfahrtszeit_plan: Optional[str] = None
    fahrt_ankunftszeit_plan: Optional[str] = None
    fahrt_zugnummer_plan: Optional[str] = None
    fahrt_zugkategorie_plan: Optional[str] = None
    fahrt_fahrkartennummer: Optional[str] = None
    fahrt_fahrkartenpreis: Optional[str] = None


# ---------------------------------------------------------------------------
# TicketOwner — type-only view of the (TICKET#<id>, OWNER) DDB row
# ---------------------------------------------------------------------------


class TicketOwner(BaseModel):
    """Type-only view of the TicketOwner DDB row.

    Schema mirrored from DB_SCHEMA.md "Ticket Owner". Used in ddb.py to
    parse `get_ticket_owner` responses — the reverse-lookup row that maps
    `ticketId → email` for callers (like this Lambda) that have only the
    ticketId.
    """

    model_config = ConfigDict(extra="ignore")

    email: str
    ticketId: str
    created_at: str
    # TTL is an epoch-seconds int when present (DDB-native TTL attribute).
    # Optional because the row may have been created without a TTL while
    # the parent ticket is still in a long-retention state.
    ttl: Optional[int] = None
