# Human: Minimal HTTP client for standalone security audits (stdlib only).
# Agent: GET/POST with retries, optional extra headers, records elapsed_ms.

from __future__ import annotations

import json
import ssl
import time
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urljoin

from .models import Config, HttpResult


def api_url(cfg: Config, route: str) -> str:
    path = f"{cfg.api_prefix}{route}"
    return urljoin(cfg.base_url + "/", path.lstrip("/"))


def _request(
    cfg: Config,
    url: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
    extra_headers: dict[str, str] | None = None,
) -> HttpResult:
    ctx = None
    if cfg.insecure_tls and url.lower().startswith("https"):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    headers = {
        "Accept": "application/json",
        "User-Agent": f"ownly-security-audit/{cfg.audit_id}",
    }
    if extra_headers:
        headers.update(extra_headers)
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=cfg.timeout_sec, context=ctx) as resp:
            raw = resp.read()
            elapsed = (time.perf_counter() - start) * 1000.0
            text = raw.decode("utf-8", errors="replace")
            hdrs = {k.lower(): v for k, v in resp.headers.items()}
            parsed: Any | None
            try:
                parsed = json.loads(text) if text.strip() else None
            except json.JSONDecodeError:
                parsed = None
            return HttpResult(
                status=resp.status,
                headers=hdrs,
                body_text=text,
                body_json=parsed,
                elapsed_ms=elapsed,
            )
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        elapsed = (time.perf_counter() - start) * 1000.0
        text = raw.decode("utf-8", errors="replace")
        hdrs = {k.lower(): v for k, v in exc.headers.items()}
        parsed: Any | None
        try:
            parsed = json.loads(text) if text.strip() else None
        except json.JSONDecodeError:
            parsed = None
        return HttpResult(
            status=exc.code,
            headers=hdrs,
            body_text=text,
            body_json=parsed,
            elapsed_ms=elapsed,
        )
    except urllib.error.URLError as exc:
        elapsed = (time.perf_counter() - start) * 1000.0
        return HttpResult(
            status=0,
            headers={},
            body_text="",
            body_json=None,
            error=str(exc.reason),
            elapsed_ms=elapsed,
        )
    except TimeoutError:
        elapsed = (time.perf_counter() - start) * 1000.0
        return HttpResult(
            status=0,
            headers={},
            body_text="",
            body_json=None,
            error=f"timeout after {cfg.timeout_sec}s",
            elapsed_ms=elapsed,
        )


def http_get(
    cfg: Config,
    url: str,
    *,
    extra_headers: dict[str, str] | None = None,
) -> HttpResult:
    return _request(cfg, url, method="GET", extra_headers=extra_headers)


def http_get_with_retries(
    cfg: Config,
    url: str,
    *,
    extra_headers: dict[str, str] | None = None,
) -> HttpResult:
    last = http_get(cfg, url, extra_headers=extra_headers)
    for _ in range(cfg.retries):
        if not last.error and last.status != 0:
            return last
        last = http_get(cfg, url, extra_headers=extra_headers)
    return last


def http_post_json(
    cfg: Config,
    url: str,
    body: dict[str, Any],
    *,
    extra_headers: dict[str, str] | None = None,
) -> HttpResult:
    return _request(cfg, url, method="POST", body=body, extra_headers=extra_headers)


def http_patch_json(
    cfg: Config,
    url: str,
    body: dict[str, Any],
    *,
    extra_headers: dict[str, str] | None = None,
) -> HttpResult:
    # Human: PATCH helper for admin user demotion/restore in SEC-002.
    # Agent: CALLS _request with method PATCH; RETURNS HttpResult.
    return _request(cfg, url, method="PATCH", body=body, extra_headers=extra_headers)


def http_delete(
    cfg: Config,
    url: str,
    *,
    extra_headers: dict[str, str] | None = None,
) -> HttpResult:
    # Human: DELETE helper for bootstrap subject cleanup in SEC-002.
    # Agent: CALLS _request with method DELETE; RETURNS HttpResult.
    return _request(cfg, url, method="DELETE", extra_headers=extra_headers)


def http_post_json_with_retries(
    cfg: Config,
    url: str,
    body: dict[str, Any],
    *,
    extra_headers: dict[str, str] | None = None,
) -> HttpResult:
    last = http_post_json(cfg, url, body, extra_headers=extra_headers)
    for _ in range(cfg.retries):
        if not last.error and last.status != 0:
            return last
        last = http_post_json(cfg, url, body, extra_headers=extra_headers)
    return last
