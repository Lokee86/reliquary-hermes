"""The first live dashboard-v1 read, admitted by the pinned Hermes plugin host."""

from __future__ import annotations

import hashlib
import os
import secrets
import threading
import time
from collections import OrderedDict
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from reliquary_hermes.client import HostClient, HostUnavailable
from reliquary_hermes.settings import Settings, profile_home, read_settings, read_token
from reliquary_hermes.ui_contract import UIRequest, UIResponse, VerifiedUIContext
from reliquary_hermes.validation import ContractError, MAX_WIRE_BYTES, canonical, require

router = APIRouter()
_CURSOR_TTL = 300.0
_CURSOR_CAP = 256
_cursors: OrderedDict[str, tuple[float, str, int]] = OrderedDict()
_cursor_lock = threading.Lock()


def _host_home(request: Request) -> Path:
    """Return only the home bound by Hermes' plugin request scope."""
    try:
        from agent.secret_scope import current_secret_scope_home
        from hermes_cli.plugin_isolation import HOST_PROCESS_ENV
        from hermes_constants import get_hermes_home, get_routing_process_hermes_home

        scoped = current_secret_scope_home()
        bound = profile_home(scoped) if scoped is not None else None
        current = profile_home(get_hermes_home())
        if getattr(request.state, "hosted_http_authenticated", False) is True:
            # Hermes admits this request over private IPC and launches one worker per profile.
            require(os.environ.get(HOST_PROCESS_ENV) == "1", "invalid_plugin_host")
            launched = profile_home(get_routing_process_hermes_home())
            require(bound is None or bound == launched, "profile_scope_mismatch")
            bound = launched
    except Exception:
        raise HTTPException(status_code=403, detail="profile_scope_unavailable") from None
    if bound is None or bound != current:
        raise HTTPException(status_code=403, detail="profile_scope_mismatch")
    return bound


def _scope_fingerprint(home: Path, profile_id: str, principal_id: str, session_id: str | None,
                       session_owner_id: str | None, limit: int, snapshot: bytes) -> str:
    # The entire canonical owner snapshot binds every row's cut and capability. The selected
    # mapping and page size are explicit so cursors cannot cross either boundary.
    value = {"home": str(home), "profile_id": profile_id, "principal_id": principal_id,
             "session_id": session_id, "session_owner_id": session_owner_id, "limit": limit,
             "snapshot": hashlib.sha256(snapshot).hexdigest()}
    return hashlib.sha256(canonical(value)).hexdigest()


def _cursor_offset(cursor: str, fingerprint: str) -> int:
    now = time.monotonic()
    with _cursor_lock:
        for token, entry in list(_cursors.items()):
            if entry[0] <= now:
                del _cursors[token]
        entry = _cursors.get(cursor)
        if entry is None or entry[1] != fingerprint:
            raise ContractError("stale_cursor")
        return entry[2]


def _issue_cursor(fingerprint: str, offset: int) -> str:
    token = secrets.token_hex(24)
    with _cursor_lock:
        now = time.monotonic()
        for key, value in list(_cursors.items()):
            if value[0] <= now:
                del _cursors[key]
        _cursors[token] = (now + _CURSOR_TTL, fingerprint, offset)
        while len(_cursors) > _CURSOR_CAP:
            _cursors.popitem(last=False)
    return token


def _error(request: UIRequest, status: str, code: str, *, retryable: bool = False) -> UIResponse:
    value = {"protocol_version": 1, "request_id": request.request_id, "operation": request.operation,
             "status": status, "binding": None, "result": {"code": code, "retryable": retryable}}
    return UIResponse.parse(canonical(value))


def _verified_context(settings: Settings, topology: dict) -> VerifiedUIContext:
    phy_id = topology["active_phy_id"]
    require(phy_id is not None, "active_phy_unavailable")
    bindings = topology["owners"]
    phy = next((owner for owner in bindings if owner["owner_id"] == phy_id and owner["owner_kind"] == "PHY"), None)
    require(phy is not None, "active_phy_unavailable")
    visible_phy_id = phy_id if phy["capabilities"]["view"] else None
    selected = topology["session_id"]
    mapped = topology["session_owner_id"]
    sessions = ()
    if selected is not None:
        rel = next((owner for owner in bindings if owner["owner_id"] == mapped and owner["owner_kind"] == "REL"), None)
        require(rel is not None and rel["capabilities"]["view"], "ui_denied")
        sessions = ((selected, mapped),)
    return VerifiedUIContext(
        profile_id=settings.profile_id,
        principal_id=phy_id,
        owner_bindings_json=canonical(bindings),
        authenticated_by_hermes=True,
        same_origin=False,
        session_rel_bindings=sessions,
        active_session_id=selected,
        active_phy_id=visible_phy_id,
    )


def _service_owner_sessions(home: Path, browser_request: UIRequest) -> UIResponse:
    """Blocking settings, socket transport, and response validation run off the ASGI loop."""
    try:
        settings = read_settings(home)
        token = read_token(home)
        client = HostClient(settings.state_dir, settings.profile_id, settings.principal_id, token)
        # The requested session is only a selector. The signed host resolves it against its own
        # configured/durable map and returns 403 for unknown IDs. Null preserves owner-level scope.
        topology = client.read_dashboard_topology(browser_request.session_id)
        context = _verified_context(settings, topology)
        request_value = browser_request.value
        request_value["profile_id"] = settings.profile_id
        request_value["principal_id"] = context.principal_id
        verified_request = UIRequest.parse(canonical(request_value))
        context.authorize(verified_request)

        owners = [owner for owner in topology["owners"]
                  if owner["capabilities"]["view"] and
                  (owner["owner_kind"] == "REL" or owner["owner_id"] == context.active_phy_id)]
        owner_json = canonical(owners)
        limit = verified_request.arguments["limit"]
        scope = _scope_fingerprint(home, context.profile_id, context.principal_id,
                                   topology["session_id"], topology["session_owner_id"], limit, owner_json)
        cursor = verified_request.arguments["cursor"]
        offset = 0 if cursor is None else _cursor_offset(cursor, scope)
        page_items = owners[offset:offset + limit]
        next_offset = offset + len(page_items)
        more = next_offset < len(owners)
        next_cursor = _issue_cursor(scope, next_offset) if more else None
        result = {"owners": {"items": page_items, "next_cursor": next_cursor, "truncated": more},
                  "active_session_id": topology["session_id"],
                  "session_owner_id": topology["session_owner_id"],
                  "active_phy_id": context.active_phy_id}
        response = UIResponse.parse(canonical({"protocol_version": 1, "request_id": verified_request.request_id,
            "operation": verified_request.operation, "status": "ok", "binding": None, "result": result}))
        return context.check_response(response, verified_request)
    except ContractError as exc:
        code = str(exc)
        status = "stale_cursor" if code == "stale_cursor" else "denied" if code in {
            "ui_denied", "active_phy_unavailable", "unbound_session"} else "unavailable"
        return _error(browser_request, status, status, retryable=status == "unavailable")
    except HostUnavailable as exc:
        status = "denied" if str(exc) == "host_denied" else "unavailable"
        return _error(browser_request, status, status, retryable=status == "unavailable")
    except Exception:
        return _error(browser_request, "unavailable", "unavailable", retryable=True)


async def _read_bounded_body(request: Request) -> bytes:
    body = bytearray()
    async for part in request.stream():
        if len(body) + len(part) > MAX_WIRE_BYTES:
            raise HTTPException(status_code=413, detail="dashboard_request_too_large")
        body.extend(part)
    return bytes(body)


@router.post("/dashboard-v1")
async def dashboard_v1(request: Request):
    """Authenticated plugin API; the browser never selects profile or principal authority."""
    try:
        from hermes_cli.web_server import _require_token
        _require_token(request)
        browser_request = UIRequest.parse(await _read_bounded_body(request))
    except HTTPException:
        raise
    except (ContractError, ValueError):
        raise HTTPException(status_code=400, detail="invalid_dashboard_request") from None
    except Exception:
        raise HTTPException(status_code=403, detail="dashboard_admission_failed") from None

    home = _host_home(request)
    # Valid but not-yet-wired operations receive a typed result after admission and verified
    # profile scope, without reading configuration or contacting the service.
    if browser_request.operation != "ui.owner_sessions":
        response = _error(browser_request, "unsupported", "operation_unavailable")
    else:
        response = await run_in_threadpool(_service_owner_sessions, home, browser_request)
    return JSONResponse(response.value, headers={"Cache-Control": "no-store"})
