# Human: Build structured leak evidence from HTTP responses for audit reports.
# Agent: READS HttpResult JSON; RETURNS LeakEvidence.

from __future__ import annotations

import json
from typing import Any

from .constants import ROUTE_SETUP_DATABASE, ROUTE_SETUP_STORAGE
from .models import HttpResult, LeakEvidence


def _format_value(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def evidence_from_json(
    title: str,
    route: str,
    res: HttpResult,
    field_order: tuple[str, ...],
) -> LeakEvidence:
    fields: dict[str, str] = {}
    if res.body_json is not None and isinstance(res.body_json, dict):
        for key in field_order:
            if key in res.body_json:
                fields[key] = _format_value(res.body_json[key])
        for key in sorted(res.body_json):
            if key not in fields:
                fields[key] = _format_value(res.body_json[key])
    elif res.body_text.strip():
        fields["raw_body"] = res.body_text.strip()
    return LeakEvidence(title=title, route=route, status=res.status, fields=fields)


def build_database_evidence(res: HttpResult) -> LeakEvidence:
    return evidence_from_json(
        "Database connection (setup wizard leak)",
        ROUTE_SETUP_DATABASE,
        res,
        ("driver", "database_url"),
    )


def build_storage_evidence(res: HttpResult) -> LeakEvidence:
    return evidence_from_json(
        "Object storage configuration",
        ROUTE_SETUP_STORAGE,
        res,
        (
            "object_storage_url",
            "object_storage_public_url",
            "object_storage_bucket",
            "storage_mode",
        ),
    )
