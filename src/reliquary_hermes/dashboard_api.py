"""Profile-scoped Reliquary APIs admitted by the pinned Hermes plugin host."""

from __future__ import annotations

import hashlib
import os
import secrets
import threading
import time
from collections import OrderedDict
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .client import HostClient, HostUnavailable
from .settings import Settings, profile_home, profile_setup_lock, read_settings, read_token
from .ui_contract import UIRequest, UIResponse, VerifiedUIContext
from .ui_schema import MUTATIONS, OP_CAPABILITY
from .validation import ContractError, MAX_WIRE_BYTES, canonical, decode, require

router = APIRouter()
_SETUP_BODY_BYTES = 65536
_SETUP_REQUIRED_FIELDS = frozenset({"main_rel", "active_phy"})
_SETUP_FIELDS = _SETUP_REQUIRED_FIELDS | {"projects", "config_path"}
_SETUP_ERRORS = {
    "runtime_unavailable": (503, "runtime_unavailable"),
    "preflight_unavailable": (503, "preflight_unavailable"),
    "service_restart_required": (409, "service_restart_required"),
    "managed_setup": (403, "managed_setup"),
    "setup_request_too_large": (413, "setup_request_too_large"),
    "project_discovery_unavailable": (503, "project_discovery_unavailable"),
    "unknown_hermes_project": (409, "unknown_hermes_project"),
    "invalid_browse_kind": (400, "invalid_browse_kind"),
    "invalid_local_path": (400, "invalid_local_path"),
    "browse_outside_roots": (403, "browse_outside_roots"),
    "browse_reparse_point": (403, "browse_reparse_point"),
    "browse_not_directory": (400, "browse_not_directory"),
    "browse_not_found": (404, "browse_not_found"),
    "browse_unreadable": (403, "browse_unreadable"),
    "browse_timeout": (503, "browse_timeout"),
    "invalid_owner_path": (400, "invalid_owner_path"),
    "owner_already_exists": (409, "owner_already_exists"),
    "owner_creation_failed": (422, "owner_creation_failed"),
    "owner_created_unverified": (422, "owner_created_unverified"),
    "owner_creation_unavailable": (503, "owner_creation_unavailable"),
    "owner_creation_unconfirmed": (503, "owner_creation_unconfirmed"),
}
_CURSOR_TTL = 300.0
_CURSOR_CAP = 256
_cursors: OrderedDict[str, tuple[float, str, int]] = OrderedDict()
_ui_cursors: OrderedDict[str, tuple[float, str, dict]] = OrderedDict()
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


def _ui_cursor_binding(home: Path, context: VerifiedUIContext, topology: dict,
                       request: UIRequest) -> str:
    value = request.value
    arguments = dict(value["arguments"])
    arguments["cursor"] = None
    binding = {
        "home": str(home), "profile_id": context.profile_id,
        "active_phy_id": context.active_phy_id, "principal_id": context.principal_id,
        "owner_id": value["owner_id"], "generation": value["generation"], "cut": value["cut"],
        "session_id": topology["session_id"], "session_owner_id": topology["session_owner_id"],
        "operation": value["operation"], "arguments": arguments,
    }
    return hashlib.sha256(canonical(binding)).hexdigest()


def _resolve_ui_cursor(token: str, fingerprint: str) -> dict:
    now = time.monotonic()
    with _cursor_lock:
        for key, entry in list(_ui_cursors.items()):
            if entry[0] <= now:
                del _ui_cursors[key]
        entry = _ui_cursors.get(token)
        if entry is None or entry[1] != fingerprint:
            raise ContractError("stale_cursor")
        _ui_cursors.move_to_end(token)
        return entry[2]


def _issue_ui_cursor(fingerprint: str, cursor: dict) -> str:
    token = secrets.token_hex(24)
    now = time.monotonic()
    with _cursor_lock:
        for key, value in list(_ui_cursors.items()):
            if value[0] <= now:
                del _ui_cursors[key]
        _ui_cursors[token] = (now + _CURSOR_TTL, fingerprint, cursor)
        while len(_ui_cursors) > _CURSOR_CAP:
            _ui_cursors.popitem(last=False)
    return token


def _set_result_cursor(result: dict, operation: str, token: str | None) -> None:
    if operation == "ui.memory_list":
        page = result
    elif operation == "ui.memory_history":
        page = result["revisions"]
    elif operation == "ui.community_list":
        page = result["communities"]
    elif operation == "ui.community_members":
        page = result["members"]
    elif operation == "ui.graph_page":
        page = result
    else:
        require(token is None, "unexpected_private_cursor")
        return
    require(page["next_cursor"] is None, "unexpected_private_cursor_placeholder")
    page["next_cursor"] = token
    if token is not None:
        page["truncated"] = True


def _error(request: UIRequest, status: str, code: str, *, retryable: bool = False) -> UIResponse:
    value = {"protocol_version": 1, "request_id": request.request_id, "operation": request.operation,
             "status": status, "binding": None, "result": {"code": code, "retryable": retryable}}
    return UIResponse.parse(canonical(value))


def _verified_context(settings: Settings, topology: dict, *, same_origin: bool = False) -> VerifiedUIContext:
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
        same_origin=same_origin,
        session_rel_bindings=sessions,
        active_session_id=selected,
        active_phy_id=visible_phy_id,
    )


def _service_owner_sessions(home: Path, browser_request: UIRequest) -> UIResponse:
    """Blocking settings, socket transport, and response validation run off the ASGI loop."""
    try:
        with profile_setup_lock(home):
            settings = read_settings(home)
            token = read_token(home)
            client = HostClient(settings.state_dir, settings.profile_id, settings.principal_id, token,
                                binary=settings.binary)
            # The signed host resolves the selector against its own configured/durable map.
            # Null preserves owner-level scope.
            topology = client.connect_dashboard(browser_request.session_id)
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
        status = "stale_cursor" if code in {"stale_cursor", "ui_stale_resync"} else "denied" if code in {
            "ui_denied", "active_phy_unavailable", "unbound_session"} else "unavailable"
        return _error(browser_request, status, status, retryable=status == "unavailable")
    except HostUnavailable as exc:
        status = "denied" if str(exc) == "host_denied" else "unavailable"
        return _error(browser_request, status, status, retryable=status == "unavailable")
    except Exception:
        return _error(browser_request, "unavailable", "unavailable", retryable=True)


def _service_dashboard_request(home: Path, browser_request: UIRequest, same_origin: bool) -> UIResponse:
    """Dispatch one authorized operation and translate any private Root cursor."""
    try:
        settings = read_settings(home)
        token = read_token(home)
        client = HostClient(settings.state_dir, settings.profile_id, settings.principal_id, token)
        topology = client.read_dashboard_topology(browser_request.session_id)
        context = _verified_context(settings, topology, same_origin=same_origin)
        request_value = browser_request.value
        request_value["profile_id"] = settings.profile_id
        request_value["principal_id"] = context.principal_id
        verified_request = UIRequest.parse(canonical(request_value))
        mutation = verified_request.operation in MUTATIONS
        owners = context.bindings()
        owner = owners.get(verified_request.owner_id)
        require(owner is not None and owner["capabilities"]["view"], "ui_denied")
        session = verified_request.session_id
        require(session is None or context.sessions(owners).get(session) == verified_request.owner_id, "ui_denied")
        if mutation:
            require(same_origin and owner["owner_kind"] == "REL", "ui_denied")
        if not owner["capabilities"][OP_CAPABILITY[verified_request.operation]]:
            return _error(browser_request, "unsupported", "operation_unavailable")
        context.authorize(verified_request, allow_mutation_replay=mutation)

        fingerprint = _ui_cursor_binding(home, context, topology, verified_request)
        opaque_cursor = verified_request.arguments.get("cursor")
        private_cursor = None if opaque_cursor is None else _resolve_ui_cursor(opaque_cursor, fingerprint)
        private_request = verified_request.value
        if "cursor" in private_request["arguments"]:
            private_request["arguments"]["cursor"] = None
        exchange = client.read_dashboard_request(private_request, private_cursor, same_origin=same_origin)
        require(type(exchange) is dict and set(exchange) == {"response", "cursor"}, "invalid_dashboard_response")
        result_value = exchange["response"]
        private_next = exchange["cursor"]
        require(private_next is None or type(private_next) is dict, "invalid_dashboard_cursor")
        require(type(result_value) is dict, "invalid_dashboard_response")
        if result_value.get("status") == "ok":
            result_value = dict(result_value)
            result_value["result"] = dict(result_value["result"])
            ui_next = None if private_next is None else _issue_ui_cursor(fingerprint, private_next)
            _set_result_cursor(result_value["result"], verified_request.operation, ui_next)
        else:
            require(private_next is None, "unexpected_private_cursor")
        response = UIResponse.parse(canonical(result_value))
        return context.check_response(response, verified_request, allow_mutation_replay=mutation)
    except ContractError as exc:
        code = str(exc)
        status = "stale_cursor" if code in {"stale_cursor", "ui_stale_resync"} else "denied" if code in {
            "ui_denied", "active_phy_unavailable", "unbound_session"} else "unavailable"
        return _error(browser_request, status, status, retryable=status == "unavailable")
    except HostUnavailable as exc:
        status = "denied" if str(exc) == "host_denied" else "unavailable"
        return _error(browser_request, status, status, retryable=status == "unavailable")
    except Exception:
        return _error(browser_request, "unavailable", "unavailable", retryable=True)


async def _read_bounded_body(request: Request, *, limit: int = MAX_WIRE_BYTES,
                             error: str = "dashboard_request_too_large") -> bytes:
    body = bytearray()
    async for part in request.stream():
        if len(body) + len(part) > limit:
            raise HTTPException(status_code=413, detail=error)
        body.extend(part)
    return bytes(body)


def _same_origin(request: Request) -> bool:
    origins = request.headers.getlist("origin")
    native = getattr(request.state, "native_http_principal", None)
    if native is not None:
        # Hermes redeems a private same-user ticket on loopback and rejects
        # any Origin before setting this request-local principal.
        return native.get("purpose") == "native-http" and not origins
    hosted = getattr(request.state, "hosted_http_authenticated", False) is True
    if hosted and getattr(request.state, "hosted_native_http_authenticated", False) is True:
        # The gateway checked the redeemed grant against this worker's profile before IPC.
        return not origins
    if len(origins) != 1:
        return False

    def origin_tuple(value: str):
        parsed = urlsplit(value)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname or
                parsed.username is not None or parsed.path or parsed.query or parsed.fragment):
            return None
        return parsed.scheme, parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80)

    try:
        origin = origin_tuple(origins[0])
        if origin is None:
            return False
        if hosted:
            # Pinned Hermes strips the public Host before private IPC. Fetch
            # Metadata is set by the browser and cannot be set by page script.
            return request.headers.getlist("sec-fetch-site") == ["same-origin"]
        hosts = request.headers.getlist("host")
        return len(hosts) == 1 and origin == origin_tuple(f"{request.url.scheme}://{hosts[0]}")
    except ValueError:
        return False


def _require_hermes_auth(request: Request, error: str) -> None:
    try:
        from hermes_cli.web_server import _require_token
        _require_token(request)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=403, detail=error) from None


async def _setup_request(request: Request, operation: str, *read_args):
    _require_hermes_auth(request, "setup_admission_failed")
    home = _host_home(request)
    args = (home, *read_args)
    kwargs = {}
    if operation in {"validate", "apply", "create"}:
        if not _same_origin(request):
            raise HTTPException(status_code=403, detail="same_origin_required")
        content_type = request.headers.get("content-type", "").partition(";")[0].strip().lower()
        if content_type != "application/json":
            raise HTTPException(status_code=415, detail="setup_json_required")
        try:
            candidate = decode(await _read_bounded_body(request, limit=_SETUP_BODY_BYTES, error="setup_request_too_large"))
            if operation != "create":
                require(_SETUP_REQUIRED_FIELDS <= set(candidate) <= _SETUP_FIELDS, "invalid_setup_candidate")
        except ContractError:
            raise HTTPException(status_code=400, detail="invalid_setup_request") from None
        args = (home, candidate)
        kwargs = {"native": "origin" not in request.headers} if operation == "create" else {"project_aware": True}

    try:
        from . import setup

        result = await run_in_threadpool(getattr(setup, operation), *args, **kwargs)
    except ContractError as exc:
        status, detail = _SETUP_ERRORS.get(str(exc), (400, "invalid_setup_request"))
        raise HTTPException(status_code=status, detail=detail) from None
    except Exception:
        raise HTTPException(status_code=503, detail="setup_unavailable") from None
    if operation == "status":
        # Without an Origin, the existing guard only admits verified native requests.
        result = {**result, "desktop_native_mutations": "origin" not in request.headers and _same_origin(request)}
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


@router.get("/setup-v1/status")
async def setup_status(request: Request):
    return await _setup_request(request, "status")


@router.get("/setup-v1/projects")
async def setup_projects(request: Request):
    return await _setup_request(request, "projects")


@router.get("/setup-v1/browse")
async def setup_browse(request: Request, kind: str = "", path: str | None = None):
    return await _setup_request(request, "browse", kind, path)


@router.post("/setup-v1/create")
async def setup_create(request: Request):
    return await _setup_request(request, "create")


@router.post("/setup-v1/validate")
async def setup_validate(request: Request):
    return await _setup_request(request, "validate")


@router.post("/setup-v1/apply")
async def setup_apply(request: Request):
    return await _setup_request(request, "apply")


@router.post("/dashboard-v1")
async def dashboard_v1(request: Request):
    """Authenticated plugin API; the browser never selects profile or principal authority."""
    _require_hermes_auth(request, "dashboard_admission_failed")
    try:
        browser_request = UIRequest.parse(await _read_bounded_body(request))
    except HTTPException:
        raise
    except (ContractError, ValueError):
        raise HTTPException(status_code=400, detail="invalid_dashboard_request") from None
    except Exception:
        raise HTTPException(status_code=403, detail="dashboard_admission_failed") from None

    home = _host_home(request)
    if browser_request.operation == "ui.owner_sessions":
        response = await run_in_threadpool(_service_owner_sessions, home, browser_request)
    else:
        same_origin = browser_request.operation in MUTATIONS and _same_origin(request)
        response = await run_in_threadpool(_service_dashboard_request, home, browser_request, same_origin)
    return JSONResponse(response.value, headers={"Cache-Control": "no-store"})
