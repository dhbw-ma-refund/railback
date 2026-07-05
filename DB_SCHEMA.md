# RailBack — DB Schema Alignment

Single-table DynamoDB design. This document is the source of truth for the
physical schema. Both the Python connector (`database` branch) and the
TypeScript connector (to be written) must match it exactly. When the two
implementations disagree, this document wins.

**Table:** `RailBack`
**Region:** `eu-north-1`
**Primary key:** `pk` (String) + `sk` (String)

---

## Attribute naming convention

All physical DynamoDB attribute names are **lowercase**. This includes primary
key attributes, GSI key attributes, and all regular item attributes.

---

## GSIs

| Index | Partition key | Sort key | Purpose |
|---|---|---|---|
| `gsi1` | `gsi1_pk` (String) | `gsi1_sk` (String) | User list, admin list, train lookup, station route lookup |
| `gsi2` | `gsi2_pk` (String) | `gsi2_sk` (String) | Barcode dedup |
| `gsi_email_pending` | `gsi_email_pending_pk` (String) | `gsi_email_pending_sk` (String) | Email retry queue (sparse) |

All GSIs use `ALL` projection.

---

## Key patterns per entity

### User profile
| Attribute | Value |
|---|---|
| `pk` | `USER#{email}` |
| `sk` | `PROFILE` |
| `gsi1_pk` | `USER` |
| `gsi1_sk` | `{email}` |

### Admin profile
| Attribute | Value |
|---|---|
| `pk` | `ADMIN#{email}` |
| `sk` | `PROFILE` |
| `gsi1_pk` | `ADMIN` |
| `gsi1_sk` | `{email}` |

### Ticket
| Attribute | Value |
|---|---|
| `pk` | `USER#{email}` |
| `sk` | `TICKET#{ticketId}` |
| `gsi1_pk` | `TRAIN#{trainNr}#{date}` |
| `gsi1_sk` | `TICKET#{ticketId}` |
| `gsi2_pk` | `BARCODE` |
| `gsi2_sk` | `{barcodeUid}` |

Email retry queue keys (sparse — only set when `email_status IN ("SENDING", "FAILED_TRANSIENT")`):

| Attribute | Value |
|---|---|
| `gsi_email_pending_pk` | `EMAIL_PENDING` |
| `gsi_email_pending_sk` | `{email_last_attempt}` — ISO-8601 UTC, millisecond precision, Z suffix e.g. `2026-07-05T12:34:56.789Z` |

**Clearing the email GSI keys:** use `REMOVE gsi_email_pending_pk, gsi_email_pending_sk`
in the UpdateExpression. Do NOT set to null — DynamoDB sparse GSI membership is
based on attribute presence, not value.

### Ticket owner
| Attribute | Value |
|---|---|
| `pk` | `TICKET#{ticketId}` |
| `sk` | `OWNER` |

### Raw upload
| Attribute | Value |
|---|---|
| `pk` | `USER#{email}` |
| `sk` | `RAW#{ticketId}` |

### Rendered PDF
| Attribute | Value |
|---|---|
| `pk` | `USER#{email}` |
| `sk` | `RENDERED#{ticketId}` |

### Original receipt (Beleg)
| Attribute | Value |
|---|---|
| `pk` | `USER#{email}` |
| `sk` | `TICKET#{ticketId}#BELEG#{belegId}` |

### SEPA mandate
| Attribute | Value |
|---|---|
| `pk` | `USER#{email}` |
| `sk` | `TICKET#{ticketId}#MANDATE` |

### SEPA report
| Attribute | Value |
|---|---|
| `pk` | `SEPA#REPORT#{date}` |
| `sk` | `REPORT#{reportId}` |

### Train segment delay
| Attribute | Value |
|---|---|
| `pk` | `TRAIN#{trainNr}#{date}` |
| `sk` | `SEG#{segId}` |
| `gsi1_pk` | `STATION#{evaCode}#{date}` |
| `gsi1_sk` | `{HH:MM}#{trainNr}` — departure time plus train number tiebreaker e.g. `08:00#ICE599` |

The `gsi1_sk` format ensures deterministic ordering when multiple trains depart
the same station at the same minute (which is a real case in the source data at
minute resolution). The `BETWEEN` query on `gsi1_sk` uses `to_time + "~"` as
the upper bound so all trains at the boundary minute are included.

### Route template
| Attribute | Value |
|---|---|
| `pk` | `USER#{email}` |
| `sk` | `TEMPLATE#{templateId}` |

---

## Integration model

The DB team writes and owns both connectors:

- **Python connector** — used by Python Lambdas (`ticket-extractor`,
  `ingest-delays`)
- **TypeScript connector** — used by Node Lambdas (`auth-handler`,
  `user-handler`, `admin-handler`, etc.)

Neither backend application team writes DynamoDB access code. All DynamoDB
operations go through the connector for the relevant runtime.

Both connectors are method-for-method mirrors of each other.

---

## Locked decisions

| Decision | Detail |
|---|---|
| Attribute case | Lowercase on the wire |
| GSI for station route lookup | GSI1 shared (not a separate GSI3) |
| Route lookup SK tiebreaker | `HH:MM#{trainNr}` |
| Email GSI sparse-write ownership | Calling Lambda owns the write/clear |
| Input validation | DB layer trusts callers — validation at HTTP boundary only |
| Region | `eu-north-1`, not changing |

---

*Last updated: 2026-07-05*
