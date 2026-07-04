# ticket-extractor

S3-triggered Python 3.12 Lambda that decodes a freshly uploaded DB ticket
file into structured fields. Cascade: **Aztec barcode (zxing-cpp + vendored
UIC 918.3 parser) → PDF text-layer (pymupdf) → MANUAL fallback** — never
crashes; `MANUAL` is always a valid output and the user fills the wizard
by hand. The Lambda derives `ticketId` from the S3 key convention
`raw/<email-hash>/<ticketId>.<ext>` and resolves the owning email through
the `TicketOwner` row, so it is race-tolerant against
`POST /upload-confirm` arriving later than the S3 event.

See `../../../ARCHITECTURE.md` ("ticket-extractor — Aztec → PDF → MANUAL
cascade") for the design-of-record, `../../../DB_SCHEMA.md` for the
DynamoDB item shapes, and `BUILD.md` for build + zip steps.
