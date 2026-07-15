#import "theme.typ": *
#import "@preview/fletcher:0.5.2" as fletcher: diagram, node, edge

#show: body => doc(
  title: "RailBack — DynamoDB Schema",
  subtitle: "ER-Modell · Single-Table Design · Query-Patterns",
  body,
)

= 1. ER-Diagramm

== Beziehungsdiagramm

#align(center, box(fill: white, inset: 6pt, width: 100%)[
  #set text(7.5pt)
  #scale(x: 94%, y: 94%, reflow: true, align(center, diagram(
    node-stroke: 0.8pt + accent,
    node-fill: softgray,
    spacing: (9mm, 13mm),
    node((1,0), [USER\_PROFILE], name: <up>, corner-radius: 3pt, inset: 6pt),
    node((3,0), [ADMIN\_PROFILE], name: <ap>, corner-radius: 3pt, inset: 6pt),
    node((0,1), [ROUTE\_TEMPLATE], name: <rt>, corner-radius: 3pt, inset: 6pt),
    node((2,1), [USER\_TICKET], name: <ut>, corner-radius: 3pt, inset: 6pt),
    node((0,2), [TICKET\_OWNER], name: <to>, corner-radius: 3pt, inset: 6pt),
    node((1,2), [RAW\_UPLOAD], name: <ru>, corner-radius: 3pt, inset: 6pt),
    node((2,2), [RENDERED\_PDF], name: <rp>, corner-radius: 3pt, inset: 6pt),
    node((3,2), [ORIGINAL\_RECEIPT], name: <or>, corner-radius: 3pt, inset: 6pt),
    node((4,2), [SEPA\_MANDATE], name: <sm>, corner-radius: 3pt, inset: 6pt),
    node((4,3), [SEPA\_REPORT], name: <sr>, corner-radius: 3pt, inset: 6pt),
    node((0,4), [TRAIN], name: <tr>, corner-radius: 3pt, inset: 6pt),
    node((1,4), [TRAIN\_SEGMENT\_DELAY], name: <tsd>, corner-radius: 3pt, inset: 6pt),

    edge(<up>, <ut>, "-|>", [besitzt 1:N], label-size: 7pt),
    edge(<up>, <rt>, "-|>", [speichert 1:N], label-size: 7pt),
    edge(<ut>, <to>, "-|>", [1:1], label-size: 7pt),
    edge(<ut>, <ru>, "-|>", [0..1], label-size: 7pt),
    edge(<ut>, <rp>, "-|>", [0..1], label-size: 7pt),
    edge(<ut>, <or>, "-|>", [Belege 0..N], label-size: 7pt),
    edge(<ut>, <sm>, "-|>", [0..1], label-size: 7pt),
    edge(<tr>, <tsd>, "-|>", [1:N], label-size: 7pt),
    edge(<ut>, <tr>, "-->", [gsi1: TRAIN\#<nr>\#<date>], label-size: 7pt, stroke: (dash: "dashed")),
    edge(<sm>, <sr>, "<->", [M:N], label-side: right, label-size: 7pt, stroke: (dash: "dashed")),
    edge(<ap>, <ut>, "-->", [verwaltet], label-size: 7pt, stroke: (dash: "dashed")),
  )))
])

== Entities & Felder
=== USER_PROFILE — `pk = USER#<email>`, `sk = PROFILE`
#fieldtable(
  keycell("email"), [String], [PK-Ableitung aus `USER#<email>`],
  keycell("vorname"), [String], [],
  keycell("nachname"), [String], [],
  keycell("telefon"), [String], [],
  keycell("adresse_strasse"), [String], [],
  keycell("adresse_hausnr"), [String], [],
  keycell("adresse_plz"), [String], [],
  keycell("adresse_ort"), [String], [],
  keycell("adresse_land"), [String], [Default DE],
  keycell("hashed_password"), [String], [bcrypt],
  keycell("user_state"), [Enum], [`ACTIVE` | `SUSPENDED` | `DELETION_SCHEDULED`],
  keycell("iban_enc"), [String], [AES-256-GCM, optional],
  keycell("bic_enc"), [String], [AES-256-GCM, optional],
  keycell("datenschutz_einwilligung"), [Bool], [],
  keycell("agb_akzeptiert"), [Bool], [],
  keycell("created_at"), [String], [ISO-8601],
  keycell("suspended_at"), [String], [optional],
  keycell("suspended_reason"), [String], [optional],
  keycell("ttl"), [Number], [optional, gesetzt bei DELETION_SCHEDULED],
)

=== ADMIN_PROFILE — `pk = ADMIN#<email>`, `sk = PROFILE`
#fieldtable(
  keycell("email"), [String], [PK-Ableitung aus `ADMIN#<email>`],
  keycell("hashed_password"), [String], [bcrypt],
  keycell("created_at"), [String], [ISO-8601],
)

=== USER_TICKET — `pk = USER#<email>`, `sk = TICKET#<id>`
#fieldtable(
  keycell("ticketId"), [String], [ULID],
  keycell("email"), [String], [Owner, aus PK],
  keycell("ticket_state"), [Enum], [9 Zustände],
  keycell("state_timeline"), [JSON], [Liste `{state, at}`],
  keycell("extraction_status"), [Enum], [`PROCESSING` | `DONE` | `FAILED`],
  keycell("extraction_method"), [Enum], [`BARCODE` | `PDF_TEXT` | `MANUAL` | `MANUAL_ROUTE`],
  keycell("extraction_confidence"), [Number], [],
  keycell("barcode_uid"), [String], [optional · GSI2-SK],
  keycell("fahrt_zugnummer_plan"), [String], [optional · Teil GSI1-PK],
  keycell("fahrt_abreisedatum"), [String], [optional · Teil GSI1-PK],
  keycell("fahrt_abreisebahnhof"), [String], [optional],
  keycell("fahrt_zielbahnhof"), [String], [optional],
  keycell("fahrt_abfahrtszeit_plan"), [String], [optional],
  keycell("fahrt_ankunftszeit_plan"), [String], [optional],
  keycell("fahrt_zugkategorie_plan"), [String], [optional],
  keycell("fahrt_fahrkartennummer"), [String], [optional],
  keycell("fahrt_fahrkartenpreis"), [String], [optional · Decimal-String],
  keycell("tatsaechlich_*"), [String], [optional · Ist-Fahrt (Ankunft/Abfahrt/Zug/Anschluss)],
  keycell("antragsgrund"), [Enum[]], [optional · `VERSPAETUNG` | `AUSFALL` | `VERPASSTER_ANSCHLUSS`],
  keycell("antragsart"), [Enum], [optional · 5 Werte],
  keycell("is_zeitkarte"), [Bool], [optional],
  keycell("antragstellung_ort"), [String], [optional],
  keycell("antragstellung_datum"), [String], [optional],
  keycell("zusaetzliche_angaben"), [String], [optional],
  keycell("datenschutz_einwilligung"), [Bool], [optional],
  keycell("wahrheitserklaerung"), [Bool], [optional],
  keycell("delayMinutes"), [Number], [optional · computed],
  keycell("erwartete_erstattung"), [String], [optional · fixiert bei Submit],
  keycell("service_fee_betrag"), [String], [optional · fixiert bei Submit],
  keycell("service_fee_state"), [Enum], [optional · `PENDING` | `DEBITED` | `REVERSED` | `WAIVED`],
  keycell("db_paid_at"), [String], [optional · admin],
  keycell("admin_note"), [String], [optional · admin],
  keycell("email_status"), [Enum], [optional · 6 Werte],
  keycell("email_attempts"), [Number], [optional],
  keycell("email_last_attempt"), [String], [optional · GSI_EMAIL_PENDING-SK],
  keycell("email_provider_id"), [String], [optional],
  keycell("email_failed_reason"), [String], [optional],
  keycell("uploaded_at"), [String], [optional],
  keycell("submitted_at"), [String], [optional],
  keycell("updated_at"), [String], [Pflicht],
  keycell("ttl"), [Number], [optional],
  keycell("archive_ttl"), [Number], [optional · app-seitig],
  keycell("belege_count"), [Number], [optional],
)

=== TICKET_OWNER — `pk = TICKET#<id>`, `sk = OWNER`
#fieldtable(
  keycell("ticketId"), [String], [aus PK],
  keycell("email"), [String], [Reverse-Lookup ticketId → email],
  keycell("created_at"), [String], [ISO-8601],
  keycell("ttl"), [Number], [optional · spiegelt Parent-Ticket],
)

=== RAW_UPLOAD — `sk = RAW#<id>` · RENDERED_PDF — `sk = RENDERED#<id>`
#fieldtable(
  keycell("ticketId"), [String], [aus SK],
  keycell("email"), [String], [FK],
  keycell("filename"), [String], [nur RawUpload],
  keycell("s3_bucket"), [String], [],
  keycell("s3_key"), [String], [],
  keycell("content_type"), [String], [nur RawUpload],
  keycell("size_bytes"), [Number], [RawUpload ≤ 10 MB],
  keycell("uploaded_at / rendered_at"), [String], [ISO-8601],
  keycell("ttl"), [Number], [optional],
)

=== ORIGINAL_RECEIPT — `sk = TICKET#<id>#BELEG#<belegId>`
#fieldtable(
  keycell("belegId"), [String], [ULID · aus SK],
  keycell("ticketId"), [String], [FK],
  keycell("email"), [String], [FK],
  keycell("filename"), [String], [],
  keycell("s3_bucket"), [String], [],
  keycell("s3_key"), [String], [],
  keycell("content_type"), [String], [],
  keycell("size_bytes"), [Number], [≤ 5 MB · max 5 Belege],
  keycell("typ"), [Enum], [`TAXI` | `BUS` | `HOTEL` | `SONSTIGES`],
  keycell("amount"), [String], [Decimal-String EUR],
  keycell("uploaded_at"), [String], [ISO-8601],
  keycell("ttl"), [Number], [optional],
)

=== SEPA_MANDATE — `sk = TICKET#<id>#MANDATE`
#fieldtable(
  keycell("ticketId"), [String], [1:1 zum Ticket],
  keycell("email"), [String], [FK],
  keycell("mandate_id"), [String], [UUID],
  keycell("mandate_state"), [Enum], [7 Zustände],
  keycell("sequence_type"), [String], [`OOFF`],
  keycell("fee_amount"), [String], [Snapshot service_fee_betrag],
  keycell("iban_enc"), [String], [AES-256-GCM Snapshot],
  keycell("bic_enc"), [String], [AES-256-GCM Snapshot],
  keycell("kontoinhaber_snapshot"), [String], [],
  keycell("user_consent_at"), [String], [Klick-Zeitpunkt],
  keycell("user_consent_ip"), [String], [optional],
  keycell("user_consent_user_agent"), [String], [optional],
  keycell("vorabankuendigung_sent_at"), [String], [optional],
  keycell("pain008_built_at"), [String], [optional],
  keycell("pain008_batch_id"), [String], [optional],
  keycell("pain008_s3_key"), [String], [optional],
  keycell("pain008_submitted_at"), [String], [optional],
  keycell("debited_at"), [String], [optional],
  keycell("reversed_at"), [String], [optional],
  keycell("reversed_reason"), [String], [optional],
  keycell("dispute_opened_at"), [String], [optional],
  keycell("expires_at"), [String], [issued_at + 36 Monate],
  keycell("issued_at"), [String], [ISO-8601],
  keycell("ttl"), [Number], [optional],
)

=== SEPA_REPORT — `pk = SEPA#REPORT#<date>`, `sk = REPORT#<reportId>`
#fieldtable(
  keycell("reportId"), [String], [aus SK],
  keycell("date"), [String], [Teil des PK],
  keycell("report_type"), [Enum], [`PAIN002` | `CAMT054` | `CAMT053`],
  keycell("s3_bucket"), [String], [],
  keycell("s3_key"), [String], [],
  keycell("sender"), [String], [],
  keycell("ingest_source"), [String], [`MANUAL_UPLOAD`],
  keycell("mandates_correlated"), [JSON], [Liste mandate_id],
  keycell("parsed_at"), [String], [ISO-8601],
  keycell("received_at"), [String], [ISO-8601],
  keycell("ttl"), [Number], [optional],
)

=== ROUTE_TEMPLATE — `sk = TEMPLATE#<id>`
#fieldtable(
  keycell("templateId"), [String], [ULID · aus SK],
  keycell("email"), [String], [FK],
  keycell("label"), [String], [Freitext],
  keycell("from_station"), [String], [],
  keycell("from_eva"), [Number], [EVA-Nummer],
  keycell("to_station"), [String], [],
  keycell("to_eva"), [Number], [EVA-Nummer],
  keycell("fahrkartennummer"), [String], [optional],
  keycell("fahrkartenpreis"), [String], [optional],
  keycell("zugkategorie_pref"), [String], [optional],
  keycell("created_at"), [String], [ISO-8601],
  keycell("updated_at"), [String], [ISO-8601],
)

=== TRAIN_SEGMENT_DELAY — `pk = TRAIN#<nr>#<date>`, `sk = SEG#<segId>`
#fieldtable(
  keycell("segId"), [String], [aus SK],
  keycell("trainNr"), [String], [Teil PK],
  keycell("date"), [String], [Teil PK],
  keycell("origin_eva"), [Number], [Teil GSI3-PK `STATION#<eva>#<date>`],
  keycell("planned_departure"), [String], [HH:MM · Teil GSI3-SK],
  keycell("delayMinutes"), [Number], [max über das Segment],
  keycell("reason"), [String], [numerischer Code],
  keycell("origin"), [String], [Stationsname],
  keycell("destination"), [String], [Stationsname],
  keycell("destination_eva"), [Number], [],
  keycell("actual_departure"), [String], [optional],
  keycell("planned_arrival"), [String], [HH:MM],
  keycell("actual_arrival"), [String], [optional],
  keycell("finalized_at"), [String], [optional · Data-Quality-Marker],
  keycell("is_cancelled"), [Bool], [],
  keycell("source"), [String], [`iris` | `piebro`],
  keycell("last_seen_at"), [String], [ISO-8601],
)

#pagebreak()

= 2. Single-Table Design

== Primärschlüssel

#table(
  columns: (auto, auto, auto),
  inset: (x: 8pt, y: 5pt),
  stroke: 0.5pt + bordergray,
  fill: (_, y) => if y == 0 { accent } else { none },
  table.header(
    text(fill: white, weight: "bold")[Rolle],
    text(fill: white, weight: "bold")[Attribut],
    text(fill: white, weight: "bold")[Typ],
  ),
  [Hash (PK)], keycell("pk"), [String],
  [Range (SK)], keycell("sk"), [String],
)

== Globale Sekundärindizes (4)

#table(
  columns: (auto, auto, auto, 1fr),
  inset: (x: 7pt, y: 5pt),
  stroke: 0.5pt + bordergray,
  fill: (_, y) => if y == 0 { accent } else { none },
  table.header(
    text(fill: white, weight: "bold")[Index],
    text(fill: white, weight: "bold")[Hash],
    text(fill: white, weight: "bold")[Range],
    text(fill: white, weight: "bold")[Zweck],
  ),
  keycell("gsi1"), keycell("gsi1_pk"), keycell("gsi1_sk"), [User-/Admin-Enumeration + Tickets nach Zug],
  keycell("gsi2"), keycell("gsi2_pk"), keycell("gsi2_sk"), [Barcode-Dedup],
  keycell("gsi_email_pending"), keycell("..._pk"), keycell("..._sk"), [Email-Retry-Queue (sparse)],
  keycell("gsi3"), keycell("gsi3_pk"), keycell("gsi3_sk"), [Route-Lookup nach Startbahnhof + Zeitfenster],
)
== Item-Collections (PK / SK Layout)

```
PARTITION  USER#<email>
├── SK  PROFILE                          -> UserProfile
├── SK  TICKET#<ticketId>                -> UserTicket        (Plain-Ticket)
├── SK  TICKET#<ticketId>#BELEG#<id>     -> OriginalReceipt
├── SK  TICKET#<ticketId>#MANDATE        -> SepaMandate
├── SK  RAW#<ticketId>                   -> RawUpload
├── SK  RENDERED#<ticketId>              -> RenderedPdf
└── SK  TEMPLATE#<templateId>            -> RouteTemplate

PARTITION  ADMIN#<email>
└── SK  PROFILE                          -> AdminProfile

PARTITION  TICKET#<ticketId>
└── SK  OWNER                            -> TicketOwner (Reverse-Lookup)

PARTITION  TRAIN#<trainNr>#<date>
└── SK  SEG#<segId>                      -> TrainSegmentDelay

PARTITION  SEPA#REPORT#<date>
└── SK  REPORT#<reportId>                -> SepaReport
```

== Key-Formate pro Entity

#table(
  columns: (auto, auto, auto, 1fr),
  inset: (x: 6pt, y: 4pt),
  stroke: 0.5pt + bordergray,
  fill: (_, y) => if y == 0 { accent } else { none },
  table.header(
    text(fill: white, weight: "bold")[Entity],
    text(fill: white, weight: "bold")[pk],
    text(fill: white, weight: "bold")[sk],
    text(fill: white, weight: "bold")[GSI-Keys],
  ),
  [UserProfile], keycell("USER#<email>"), keycell("PROFILE"), [gsi1: `USER` / `EMAIL#<email>`],
  [AdminProfile], keycell("ADMIN#<email>"), keycell("PROFILE"), [gsi1: `ADMIN` / `EMAIL#<email>`],
  [UserTicket], keycell("USER#<email>"), keycell("TICKET#<id>"), [gsi1: `TRAIN#<nr>#<date>` / `TICKET#<id>` · gsi2: `BARCODE` / `<uid>` · gsi\_email\_pending: `EMAIL_PENDING` / `<email_last_attempt>` — alle sparse],
  [TicketOwner], keycell("TICKET#<id>"), keycell("OWNER"), [—],
  [RawUpload], keycell("USER#<email>"), keycell("RAW#<id>"), [—],
  [RenderedPdf], keycell("USER#<email>"), keycell("RENDERED#<id>"), [—],
  [OriginalReceipt], keycell("USER#<email>"), keycell("TICKET#<id>#BELEG#<belegId>"), [—],
  [SepaMandate], keycell("USER#<email>"), keycell("TICKET#<id>#MANDATE"), [—],
  [SepaReport], keycell("SEPA#REPORT#<date>"), keycell("REPORT#<reportId>"), [—],
  [RouteTemplate], keycell("USER#<email>"), keycell("TEMPLATE#<id>"), [—],
  [TrainSegmentDelay], keycell("TRAIN#<nr>#<date>"), keycell("SEG#<segId>"), [gsi3-pk: `STATION#<eva>#<date>` \ gsi3-sk: `<dep>#<trainNr>`],
)

== Sparse-GSI-Regeln beim Ticket

Die GSI-Keys auf `UserTicket` werden bewusst nur *bedingt* gesetzt (sonst
REMOVE) — dadurch bleiben die Indizes klein:

- *gsi1* gesetzt, wenn `fahrt_zugnummer_plan` *und* `fahrt_abreisedatum` vorhanden.
- *gsi2* gesetzt, wenn `barcode_uid` vorhanden.
- *gsi_email_pending* gesetzt, wenn alle gelten: `email_status ∈ {SENDING, FAILED_TRANSIENT}` *und* `email_attempts < 3` *und* `email_last_attempt` gesetzt *und* `ticket_state = EMAIL_SENDING`. Bei jedem State-Übergang werden die Keys geräumt (SES 2xx → SENT, Delivery → DELIVERED, Attempt 3 → FAILED).

== Enums

#table(
  columns: (auto, 1fr),
  inset: (x: 7pt, y: 4pt),
  stroke: 0.5pt + bordergray,
  fill: (_, y) => if y == 0 { accent } else { none },
  table.header(
    text(fill: white, weight: "bold")[Enum],
    text(fill: white, weight: "bold")[Werte],
  ),
  keycell("ticket_state"), [`VALIDATING`, `READY`, `EMAIL_SENDING`, `PENDING_DB_PAYMENT`, `APPROVED`, `REJECTED`, `COMPLETED`, `EMAIL_FAILED`, `INVALID`],
  [— terminal], [`INVALID`, `REJECTED`, `COMPLETED`, `EMAIL_FAILED`],
  keycell("user_state"), [`ACTIVE`, `SUSPENDED`, `DELETION_SCHEDULED`],
  keycell("email_status"), [`SENDING`, `SENT`, `FAILED_TRANSIENT`, `DELIVERED`, `BOUNCED`, `FAILED`],
  keycell("extraction_method"), [`BARCODE`, `PDF_TEXT`, `MANUAL`, `MANUAL_ROUTE`],
  keycell("extraction_status"), [`PROCESSING`, `DONE`, `FAILED`],
  keycell("antragsart"), [`ERSTATTUNG_FAHRKARTE`, `ENTSCHAEDIGUNG_60_119`, `ENTSCHAEDIGUNG_120_PLUS`, `ENTSCHAEDIGUNG_ZEITKARTE`, `KOSTEN_ALTERNATIVTRANSPORT`],
  keycell("antragsgrund"), [`VERSPAETUNG`, `AUSFALL`, `VERPASSTER_ANSCHLUSS`],
  keycell("mandate_state"), [`ISSUED`, `SUBMITTED`, `DEBITED`, `REVERSED`, `DISPUTED`, `EXPIRED`, `CANCELLED`],
  keycell("service_fee_state"), [`PENDING`, `DEBITED`, `REVERSED`, `WAIVED`],
  keycell("beleg_typ"), [`TAXI`, `BUS`, `HOTEL`, `SONSTIGES`],
  keycell("role"), [`USER`, `ADMIN`],
)

#pagebreak()

= 3. Query-Patterns

== User / Admin — Partition `USER#<email>` / `ADMIN#<email>`

#table(
  columns: (auto, 1fr, auto, auto, 1.3fr),
  inset: (x: 6pt, y: 4pt),
  stroke: 0.5pt + bordergray,
  fill: (_, y) => if y == 0 { accent } else { none },
  table.header(
    text(fill: white, weight: "bold")[\#],
    text(fill: white, weight: "bold")[Zugriff],
    text(fill: white, weight: "bold")[Op],
    text(fill: white, weight: "bold")[Index],
    text(fill: white, weight: "bold")[Key / Filter],
  ),
  [U1], [Profil lesen], [GetItem], [Basis], [`pk = USER#<email>`, `sk = PROFILE`],
  [U2], [Profil für Auth (pw + state)], [GetItem], [Basis], [wie U1, projiziert `hashed_password`, `user_state`],
  [U3], [Profil für Admin (inkl. `iban_enc`/`bic_enc`)], [GetItem], [Basis], [wie U1, volle Row],
  [U4], [Profil schreiben / updaten], [Put/Update], [Basis], [`pk = USER#<email>`, `sk = PROFILE`],
  [U5], [Alle User auflisten (Admin)], [Query], [`gsi1`], [`gsi1_pk = "USER"`],
  [U6], [User nach Email-Prefix], [Query], [`gsi1`], [`gsi1_pk = "USER" AND begins_with(gsi1_sk, "EMAIL#<prefix>")`],
  [A1], [Admin-Profil lesen / schreiben], [GetItem/Put], [Basis], [`pk = ADMIN#<email>`, `sk = PROFILE`],
  [A2], [Alle Admins auflisten], [Query], [`gsi1`], [`gsi1_pk = "ADMIN"`],
  [D1], [Ganze User-Akte holen], [Query], [Basis], [`pk = USER#<email>` (kein SK-Filter → alle Sub-Rows)],
  [D2], [User hart löschen (Cascade)], [Query+BatchDelete], [Basis], [Query `pk = USER#<email>`, dann BatchDelete inkl. gepaarter `TICKET#<id>`/`OWNER`-Rows],
)

== Tickets — Partition `USER#<email>`, SK-Prefix `TICKET#`

#table(
  columns: (auto, 1fr, auto, auto, 1.3fr),
  inset: (x: 6pt, y: 4pt),
  stroke: 0.5pt + bordergray,
  fill: (_, y) => if y == 0 { accent } else { none },
  table.header(
    text(fill: white, weight: "bold")[\#],
    text(fill: white, weight: "bold")[Zugriff],
    text(fill: white, weight: "bold")[Op],
    text(fill: white, weight: "bold")[Index],
    text(fill: white, weight: "bold")[Key / Filter],
  ),
  [T1], [Einzelnes Ticket lesen], [GetItem], [Basis], [`pk = USER#<email>`, `sk = TICKET#<id>`],
  [T2], [Ticket schreiben / patchen], [Put/Update], [Basis], [s. T1, GSI-Keys via `deriveTicketGsiKeys`],
  [T3], [Alle Tickets eines Users], [Query], [Basis], [`begins_with(sk, "TICKET#")`, danach Filter auf Plain-Ticket-SK],
  [T4], [Tickets nach Zug+Datum], [Query], [`gsi1`], [`gsi1_pk = "TRAIN#<nr>#<date>"`],
  [T5], [Ticket-Create (Ticket + Owner atomar)], [Transaction], [Basis], [`UserTicket` + `TicketOwner` in einem `TransactWriteItems`],
  [T6], [Ticket + Sub-Rows löschen], [Query+BatchDelete], [Basis], [Query `begins_with(sk, "TICKET#<id>#")` + explizit `TICKET#<id>`, `OWNER`, `RAW#<id>`, `RENDERED#<id>`],
)

=== Admin-Ticket-Liste `GET /admin/tickets` — 3 Routen

Der Handler wählt die Route nach übergebenen Query-Parametern:

#table(
  columns: (auto, 1.1fr, auto, auto, 1.3fr),
  inset: (x: 6pt, y: 4pt),
  stroke: 0.5pt + bordergray,
  fill: (_, y) => if y == 0 { accent2 } else { none },
  table.header(
    text(fill: white, weight: "bold")[Route],
    text(fill: white, weight: "bold")[Bedingung],
    text(fill: white, weight: "bold")[Op],
    text(fill: white, weight: "bold")[Index],
    text(fill: white, weight: "bold")[Key + optionale Filter],
  ),
  [1], [`trainNr` und `date`], [Query], [`gsi1`], [`gsi1_pk = "TRAIN#<nr>#<date>"` · Filter opt.: `ticket_state`, `pk`],
  [2], [nur `email`], [Query], [Basis], [`begins_with(sk, "TICKET#")` · Filter opt.: `ticket_state`, `fahrt_abreisedatum` ≥/≤],
  [3], [sonst (inkl. nur `state`)], [Scan], [Basis], [`begins_with(sk, "TICKET#")` + Filter: `ticket_state`, `fahrt_zugnummer_plan`, `fahrt_abreisedatum`, from/to · Admin-Klick, nicht automatisch],
)

Die *Review-Queue* = Route 3 mit `state = PENDING_DB_PAYMENT`. Pagination via
base64-`cursor` (kodiert `ExclusiveStartKey`).

=== Ticket-Spezial-Queries

#table(
  columns: (auto, 1fr, auto, auto, 1.3fr),
  inset: (x: 6pt, y: 4pt),
  stroke: 0.5pt + bordergray,
  fill: (_, y) => if y == 0 { accent2 } else { none },
  table.header(
    text(fill: white, weight: "bold")[\#],
    text(fill: white, weight: "bold")[Zugriff],
    text(fill: white, weight: "bold")[Op],
    text(fill: white, weight: "bold")[Index],
    text(fill: white, weight: "bold")[Key],
  ),
  [T7], [Barcode-Dedup (Duplikat-Upload)], [Query], [`gsi2`], [`gsi2_pk = "BARCODE" AND gsi2_sk = <uid>`, `Limit 1`; Treffer → `GetItem` fürs volle Ticket],
  [T8], [Email-Retry-Queue (Sweeper)], [Query], [`gsi_email_pending`], [`gsi_email_pending_pk = "EMAIL_PENDING"`, `ScanIndexForward = true` (oldest-first), pro Treffer `GetItem`],
  [T9], [Email-Watchdog], [Scan], [Basis], [Filter `email_status = "SENT" AND email_last_attempt < now-24h AND ticket_state = "EMAIL_SENDING"`],
)

`gsi2` und `gsi_email_pending` sind sparse und KEYS_ONLY — der Treffer trägt
nur `pk`/`sk`, das volle Item wird per `GetItem` nachgeladen.

== TicketOwner — Reverse-Lookup, Partition `TICKET#<id>`

#table(
  columns: (auto, 1fr, auto, auto, 1.1fr),
  inset: (x: 6pt, y: 4pt),
  stroke: 0.5pt + bordergray,
  fill: (_, y) => if y == 0 { accent } else { none },
  table.header(
    text(fill: white, weight: "bold")[\#],
    text(fill: white, weight: "bold")[Zugriff],
    text(fill: white, weight: "bold")[Op],
    text(fill: white, weight: "bold")[Index],
    text(fill: white, weight: "bold")[Key],
  ),
  [O1], [`ticketId → email`], [GetItem], [Basis], [`pk = TICKET#<id>`, `sk = OWNER`],
  [O2], [Owner-Row schreiben], [Put], [Basis], [s. O1 (in T5)],
  [O3], [Owner-Row löschen], [Delete], [Basis], [s. O1],
)

Genutzt von `admin-handler`, `email-webhook` (SES-Event trägt nur die
Ticket-ID) und `ticket-extractor` (S3-Key trägt nur den Email-Hash).

== Blobs — RawUpload / RenderedPdf / Receipt — Partition `USER#<email>`

#table(
  columns: (auto, 1fr, auto, auto, 1.2fr),
  inset: (x: 6pt, y: 4pt),
  stroke: 0.5pt + bordergray,
  fill: (_, y) => if y == 0 { accent } else { none },
  table.header(
    text(fill: white, weight: "bold")[\#],
    text(fill: white, weight: "bold")[Zugriff],
    text(fill: white, weight: "bold")[Op],
    text(fill: white, weight: "bold")[Index],
    text(fill: white, weight: "bold")[Key],
  ),
  [B1], [Raw-Upload lesen / schreiben], [GetItem/Put], [Basis], [`sk = RAW#<ticketId>`],
  [B2], [Rendered-PDF lesen / schreiben], [GetItem/Put], [Basis], [`sk = RENDERED#<ticketId>`],
  [B3], [Beleg lesen / schreiben], [GetItem/Put], [Basis], [`sk = TICKET#<ticketId>#BELEG#<belegId>`],
  [B4], [Alle Belege eines Tickets], [Query], [Basis], [`begins_with(sk, "TICKET#<ticketId>#BELEG#")`],
)

== SEPA-Mandate — Partition `USER#<email>`, SK `TICKET#<id>#MANDATE`

#table(
  columns: (auto, 1fr, auto, auto, 1.4fr),
  inset: (x: 6pt, y: 4pt),
  stroke: 0.5pt + bordergray,
  fill: (_, y) => if y == 0 { accent } else { none },
  table.header(
    text(fill: white, weight: "bold")[\#],
    text(fill: white, weight: "bold")[Zugriff],
    text(fill: white, weight: "bold")[Op],
    text(fill: white, weight: "bold")[Index],
    text(fill: white, weight: "bold")[Key / Filter],
  ),
  [M1], [Mandate lesen / schreiben], [GetItem/Put/Update], [Basis], [`sk = TICKET#<ticketId>#MANDATE`],
  [M2], [pain008-Build stempeln (idempotent)], [Update (bedingt)], [Basis], [Condition `attribute_exists(pk) AND attribute_not_exists(pain008_built_at)`],
  [M3], [Pending Batches (built, nicht submitted)], [Scan], [Basis], [`mandate_state = "ISSUED"` \ `AND attribute_exists(pain008_built_at)` \ `AND attribute_not_exists(` \ `pain008_submitted_at)` \ Admin-Klick, nicht automatisch],
  [M4], [Mandate nach Batch-ID], [Scan], [Basis], [`pain008_batch_id = <id>` · Admin-Klick, nicht automatisch],
  [M5], [Abgelaufene ISSUED-Mandate], [Scan], [Basis], [`mandate_state = "ISSUED" AND expires_at < now` · läuft nächtlich],
)

Alle Mandate-Scans akzeptieren nur Rows mit SK-Endung `#MANDATE` und
überspringen anonymisierte Partitionen (`NOT begins_with(pk, "USER#sha256:")`).

== SEPA-Reports — Partition `SEPA#REPORT#<date>`

#table(
  columns: (auto, 1fr, auto, auto, 1.1fr),
  inset: (x: 6pt, y: 4pt),
  stroke: 0.5pt + bordergray,
  fill: (_, y) => if y == 0 { accent } else { none },
  table.header(
    text(fill: white, weight: "bold")[\#],
    text(fill: white, weight: "bold")[Zugriff],
    text(fill: white, weight: "bold")[Op],
    text(fill: white, weight: "bold")[Index],
    text(fill: white, weight: "bold")[Key],
  ),
  [R1], [Report lesen / schreiben], [GetItem/Put], [Basis], [`pk = SEPA#REPORT#<date>`, `sk = REPORT#<reportId>`],
  [R2], [Reports nach Datum], [Query], [Basis], [`pk = SEPA#REPORT#<date>`],
)

== Route-Templates — Partition `USER#<email>`, SK `TEMPLATE#`

#table(
  columns: (auto, 1fr, auto, auto, 1.1fr),
  inset: (x: 6pt, y: 4pt),
  stroke: 0.5pt + bordergray,
  fill: (_, y) => if y == 0 { accent } else { none },
  table.header(
    text(fill: white, weight: "bold")[\#],
    text(fill: white, weight: "bold")[Zugriff],
    text(fill: white, weight: "bold")[Op],
    text(fill: white, weight: "bold")[Index],
    text(fill: white, weight: "bold")[Key],
  ),
  [P1], [Template lesen / schreiben], [GetItem/Put], [Basis], [`sk = TEMPLATE#<templateId>`],
  [P2], [Alle Templates eines Users], [Query], [Basis], [`begins_with(sk, "TEMPLATE#")`],
)

== Verspätungen — TrainSegmentDelay — Partition `TRAIN#<nr>#<date>`

#table(
  columns: (auto, 1fr, auto, auto, 1.4fr),
  inset: (x: 6pt, y: 4pt),
  stroke: 0.5pt + bordergray,
  fill: (_, y) => if y == 0 { accent } else { none },
  table.header(
    text(fill: white, weight: "bold")[\#],
    text(fill: white, weight: "bold")[Zugriff],
    text(fill: white, weight: "bold")[Op],
    text(fill: white, weight: "bold")[Index],
    text(fill: white, weight: "bold")[Key],
  ),
  [V1], [Segment lesen / schreiben], [GetItem/Put], [Basis], [`pk = TRAIN#<nr>#<date>`, `sk = SEG#<segId>`],
  [V2], [Alle Segmente eines Zuglaufs (`/delays`)], [Query], [Basis], [`begins_with(sk, "SEG#")`],
  [V3], [Route-Lookup (Startbhf + Zeitfenster)], [Query], [`gsi3`], [`gsi3_pk = "STATION#<origin_eva>#<date>" AND gsi3_sk BETWEEN <fromTime> AND <toTime>`],
)

V3 ist die Basis für `MANUAL_ROUTE`-Tickets: liefert alle Züge, die im
Zeitfenster im Startbahnhof abfahren; danach pro Zug ein V2 auf den vollen
Stop-Verlauf, um den Zielbahnhof als späteren Stop zu bestätigen und
`max(delayMinutes)` über die Segmente A→B zu rechnen.
