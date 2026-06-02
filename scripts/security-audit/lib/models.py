# Human: Data shapes shared across SEC audit probe, report, and export formats.
# Agent: dataclasses only; no HTTP or I/O.

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Config:
    base_url: str
    api_prefix: str
    timeout_sec: float
    insecure_tls: bool
    require_setup_complete: bool
    verbose: bool
    show_leaks: bool
    redact_output: bool
    output_format: str
    quiet: bool
    compact: bool
    strict_heuristics: bool
    retries: int
    fail_fast: bool
    output_file: str | None
    compare_baseline: str | None
    save_baseline: str | None


@dataclass
class HttpResult:
    status: int
    headers: dict[str, str]
    body_text: str
    body_json: Any | None
    error: str | None = None
    elapsed_ms: float | None = None


@dataclass
class CaseResult:
    name: str
    passed: bool
    detail: str
    severity: str
    evidence_key: str | None = None
    remediation: str | None = None


@dataclass
class LeakEvidence:
    title: str
    route: str
    status: int
    fields: dict[str, str]


@dataclass
class AuditReport:
    audit_id: str
    target: str
    verdict: str
    exit_code: int
    setup_complete: bool | None
    results: list[CaseResult] = field(default_factory=list)
    evidence: dict[str, LeakEvidence] = field(default_factory=dict)
    timings_ms: dict[str, float] = field(default_factory=dict)
    remediation_hints: list[str] = field(default_factory=list)
