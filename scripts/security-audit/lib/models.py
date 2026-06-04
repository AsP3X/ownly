# Human: Data shapes shared across SEC audit probe, report, and export formats.
# Agent: dataclasses only; no HTTP or I/O.

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Config:
    audit_id: str
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
class Sec002Config:
    # Human: SEC-002 credentials and demotion probe options layered on shared HTTP config.
    # Agent: READS env/CLI; WRITES runner_sec002; no secrets in saved baselines.
    http: Config
    subject_email: str
    subject_password: str
    demoter_email: str
    demoter_password: str
    demote_role: str
    admin_probe_route: str
    restore_admin_role: bool
    bootstrap_subject: bool


@dataclass
class Sec003Config:
    # Human: SEC-003 public share + recycle bin probe options on shared HTTP config.
    # Agent: READS env/CLI; WRITES runner_sec003; optional bootstrap uploads a probe file.
    http: Config
    owner_email: str
    owner_password: str
    share_password: str
    folder_id: str
    file_id: str
    share_token: str
    bootstrap_fixtures: bool
    restore_after_probe: bool


@dataclass
class Sec004Config:
    # Human: SEC-004 authenticated download/preview after soft-delete probe options.
    # Agent: READS env/CLI; WRITES runner_sec004.
    http: Config
    owner_email: str
    owner_password: str
    file_id: str
    bootstrap_fixtures: bool
    restore_after_probe: bool


@dataclass
class Sec005Config:
    # Human: SEC-005 unauthenticated setup bootstrap probe options.
    # Agent: READS env/CLI; WRITES runner_sec005; uses safe invalid POST body only.
    http: Config
    bootstrap_header: str


@dataclass
class Sec006Config:
    # Human: SEC-006 rate-limit header spoofing probe options.
    # Agent: READS env/CLI; WRITES runner_sec006; bursts login/register with spoofed IPs.
    http: Config
    login_rpm: int
    register_rpm: int
    probe_register: bool


@dataclass
class Sec007Config:
    # Human: SEC-007 password-protected share overview bypass probe options.
    # Agent: READS env/CLI; WRITES runner_sec007; bootstraps folder share + password PATCH.
    http: Config
    owner_email: str
    owner_password: str
    share_password: str
    folder_id: str
    file_id: str
    share_id: str
    share_token: str
    bootstrap_fixtures: bool
    revoke_after_probe: bool


@dataclass
class Sec008Config:
    # Human: SEC-008 setup storage test SSRF probe options.
    # Agent: READS env/CLI; WRITES runner_sec008; probes internal URLs without auth.
    http: Config
    require_pre_setup: bool
    probe_targets: tuple[tuple[str, str], ...]


@dataclass
class Sec009Config:
    # Human: SEC-009 share password brute-force throttling probe options.
    # Agent: READS env/CLI; WRITES runner_sec009; bursts wrong x-share-password guesses.
    http: Config
    owner_email: str
    owner_password: str
    share_password: str
    folder_id: str
    file_id: str
    share_id: str
    share_token: str
    bootstrap_fixtures: bool
    revoke_after_probe: bool
    wrong_attempts: int


@dataclass
class Sec010Config:
    # Human: SEC-010 setup database test internal Postgres probe options.
    # Agent: READS env/CLI; WRITES runner_sec010; probes internal DB URLs without auth.
    http: Config
    require_pre_setup: bool
    probe_targets: tuple[tuple[str, str], ...]


@dataclass
class Sec011Config:
    # Human: SEC-011 zip archive includes soft-deleted files probe options.
    # Agent: READS env/CLI; WRITES runner_sec011; bulk + folder zip after trash.
    http: Config
    owner_email: str
    owner_password: str
    folder_id: str
    file_id: str
    bootstrap_fixtures: bool
    restore_after_probe: bool


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
