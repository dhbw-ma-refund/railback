"""Structured JSON logging for the ticket-extractor Lambda.

One log line = one JSON object on stderr. CloudWatch picks each line up as
a discrete log event and indexes the JSON fields automatically (no
multi-line parsing config needed).

Fields on every line:
    - timestamp: UTC ISO-8601 with `+00:00` offset
    - level:     "INFO" / "WARNING" / "ERROR" / ...
    - logger:    the logger name (`src.handler`, `src.extract`, etc.)
    - message:   the log message text

Plus any extra kwargs the caller passes via `logger.info(msg, extra={...})`.

Privacy: NEVER log raw email addresses. Use `email_fingerprint(email)`
which is a stable but irreversible identifier (mirrors `keys.email_hash`).
The fingerprint is good enough to correlate log lines for a single user
across a session while leaving zero PII in CloudWatch.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any

from .keys import email_hash

# Reserved attributes on logging.LogRecord — we never copy these into the
# JSON output as "extra" fields (otherwise we'd double-emit). Source:
# stdlib logging.LogRecord.__init__.
_RESERVED_RECORD_KEYS = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "message",
        "module",
        "msecs",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
    }
)


class _JsonFormatter(logging.Formatter):
    """Emit each LogRecord as a single-line JSON object."""

    def format(self, record: logging.LogRecord) -> str:
        # Use the record's own UTC timestamp (record.created is epoch seconds).
        ts = datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat()

        payload: dict[str, Any] = {
            "timestamp": ts,
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Collect anything passed via `extra={...}` — those land as
        # attributes on the LogRecord that are NOT in _RESERVED_RECORD_KEYS.
        for key, value in record.__dict__.items():
            if key in _RESERVED_RECORD_KEYS or key.startswith("_"):
                continue
            payload[key] = value

        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str, ensure_ascii=False)


# Tracks whether init_logging has already configured the root logger.
# Idempotent — repeated calls (e.g. from per-record handler retries) are
# cheap no-ops.
_initialised = False


def init_logging(level: str = "INFO") -> None:
    """Idempotently configure the root logger with a JSON handler on stderr.

    Lambda's default log handler emits plain text and adds a Request-ID
    prefix; we replace it with our JSON handler so log aggregation tools
    get structured data. Calling this multiple times has no effect after
    the first call.
    """
    global _initialised
    if _initialised:
        return

    root = logging.getLogger()
    # Clear Lambda's default handler so we don't double-emit. Lambda
    # adds a LambdaLoggerHandler at process start; removing it is safe
    # because our handler writes the same stream (stderr).
    for h in list(root.handlers):
        root.removeHandler(h)

    handler = logging.StreamHandler(stream=sys.stderr)
    handler.setFormatter(_JsonFormatter())
    root.addHandler(handler)
    root.setLevel(level.upper())

    _initialised = True


def get_logger(name: str) -> logging.Logger:
    """Return a configured logger. Calls `init_logging` lazily so callers
    can `from .logging_setup import get_logger` without an explicit init
    step in every module."""
    init_logging()
    return logging.getLogger(name)


def email_fingerprint(email: str) -> str:
    """Stable, irreversible identifier for log correlation.

    Identical to `keys.email_hash` — re-exported here so callers don't
    have to import both modules just to log a user-scoped message.
    """
    return email_hash(email)
