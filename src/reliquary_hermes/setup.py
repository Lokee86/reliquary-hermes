"""Canonical profile setup for the CLI and Hermes surface adapters."""

import hashlib
import os
from pathlib import Path
import subprocess

from . import setup_paths
from .capture_policy import ENROLLMENT_FILE, capture_cutoff
from .client import HostClient, HostUnavailable
from .projects import active_projects, inventory
from .settings import (
    _read_object, _state_dir, ensure_setup_token, profile_home, profile_setup_lock, read_settings, read_token,
    save_settings,
)
from .validation import ContractError, MAX_WIRE_BYTES, canonical, decode, identifier, obj, require, text

_OWNER_REPORT_FIELDS = {"accepted", "opened", "kind", "owner_id", "scope", "error"}
_CREATE_ROLES = {"general_rel": "main_rel", "project_rel": "project_rel", "phy": "active_phy"}
_CREATE_ERRORS = {b"owner_already_exists", b"invalid_owner_path", b"owner_creation_failed",
                  b"owner_created_unverified"}


def _read_optional(path):
    try:
        return _read_object(path)
    except FileNotFoundError:
        return {}


def _local_path(value):
    value = text(value)
    path = Path(value)
    require(path.is_absolute() and "\0" not in value and not value.startswith(("\\\\", "//")), "invalid_local_path")
    return value


def _defaults(home):
    state = _state_dir(home)
    prior = _read_optional(state / "owners.json")
    processing = _read_optional(state / "processing.json")
    config = obj(processing, {"config_path"})["config_path"] if processing else None
    if config is None:
        detected = os.environ.get("RELIQUARY_CONFIG_PATH") or str(state / "reliquary.cfg")
        try:
            detected = _local_path(detected)
            if Path(detected).is_file():
                config = detected
        except ContractError:
            pass
    installed = home / "plugins" / "reliquary" / "host" / "reliquary-hermes-host.exe"
    # Existing installations may already refer to a separately provisioned host.
    saved = _read_optional(state / "provider.json").get("binary")
    binary = installed if installed.is_file() or not saved else Path(saved)
    defaults = {"main_rel": prior.get("main_rel"), "active_phy": prior.get("active_phy"),
                "projects": prior.get("projects", {}), "config_path": config}
    return prior, processing, binary, defaults


def _activation(home):
    from hermes_cli.config import load_config_readonly
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    scope = set_hermes_home_override(home)
    try:
        return load_config_readonly()
    finally:
        reset_hermes_home_override(scope)


def status(home):
    home = profile_home(home)
    configured = False
    try:
        read_settings(home)
        read_token(home)
        configured = (_activation(home).get("memory") or {}).get("provider") == "reliquary"
    except (OSError, ValueError):
        pass
    _, _, binary, defaults = _defaults(home)
    return {"configured": configured, "runtime_detected": binary.is_absolute() and binary.is_file(),
            "config_path": defaults["config_path"], "defaults": defaults}


def _candidate(home, candidate, prior, defaults, *, project_aware=False):
    fields = {"main_rel", "active_phy"}
    require(type(candidate) is dict and fields <= set(candidate) <= fields | {"projects", "config_path"},
            "invalid_fields")
    projects = candidate.get("projects", defaults["projects"])
    require(type(projects) is dict and len(projects) <= 128, "invalid_project_config")
    projects = {identifier(key): _local_path(path) for key, path in projects.items()}
    if project_aware and projects != defaults["projects"]:
        active = active_projects(home)
        previous = defaults["projects"]
        for project in projects.keys() | previous.keys():
            if projects.get(project) != previous.get(project):
                require(project in active, "unknown_hermes_project")
    config = candidate.get("config_path")
    if config is None:
        config = defaults["config_path"]
    if config is not None:
        config = _local_path(config)
    # The canonical profile location supplies fresh IDs. Persisted IDs remain stable.
    home_key = os.path.normcase(str(home)).encode("utf-8")
    profile_id = prior.get("profile_id", "hermes-" + hashlib.sha256(home_key).hexdigest()[:32])
    owners = {"profile_id": identifier(profile_id),
              "principal_id": identifier(prior.get("principal_id", profile_id + "-operator")),
              "main_rel": _local_path(candidate["main_rel"]), "active_phy": _local_path(candidate["active_phy"]),
              "projects": projects}
    if "session_projects" in prior:
        mappings = prior["session_projects"]
        require(type(mappings) is dict and all(type(project) is str and project in projects
                for project in mappings.values()), "invalid_project_config")
        owners["session_projects"] = mappings
    return {"owners": owners, "config_path": config}


def _owner_report(value):
    row = obj(value, _OWNER_REPORT_FIELDS)
    require(type(row["accepted"]) is bool and type(row["opened"]) is bool, "invalid_preflight")
    require(row["kind"] in (None, "rel", "phy"), "invalid_preflight")
    require(row["scope"] in (None, "unspecified", "organization", "project", "connection"), "invalid_preflight")
    for field in ("owner_id", "error"):
        if row[field] is not None:
            identifier(row[field])


def _host_setup(home, binary, operation, request):
    require(binary.is_absolute() and binary.is_file(), "runtime_unavailable")
    wire = canonical(request)
    require(len(wire) <= MAX_WIRE_BYTES, "setup_request_too_large")
    environment = {name: os.environ[name] for name in ("SystemRoot", "WINDIR") if name in os.environ}
    environment.update({name: str(home) for name in ("TEMP", "TMP", "TMPDIR")})
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    return subprocess.run([str(binary), operation, "--state-dir", str(_state_dir(home))],
                          input=wire, capture_output=True, cwd=home, env=environment,
                          creationflags=flags, timeout=15, check=True)


def _preflight(home, binary, request):
    try:
        result = _host_setup(home, binary, "setup-validate", request)
        report = obj(decode(result.stdout), {"valid", "main_rel", "active_phy", "projects", "config", "topology_error"})
        require(type(report["valid"]) is bool, "invalid_preflight")
        _owner_report(report["main_rel"])
        _owner_report(report["active_phy"])
        for row in obj(report["projects"], set(request["owners"]["projects"])).values():
            _owner_report(row)
        config = obj(report["config"], {"accepted", "opened", "error"})
        require(type(config["accepted"]) is bool and type(config["opened"]) is bool, "invalid_preflight")
        for error in (config["error"], report["topology_error"]):
            if error is not None:
                identifier(error)
        return report
    except ContractError as exc:
        if str(exc) in {"runtime_unavailable", "setup_request_too_large"}:
            raise
        raise ContractError("preflight_unavailable") from None
    except (OSError, ValueError, subprocess.SubprocessError):
        raise ContractError("preflight_unavailable") from None


def projects(home):
    return inventory(profile_home(home))


def browse(home, kind, path):
    home = profile_home(home)
    _, _, _, defaults = _defaults(home)
    return setup_paths.browse(home, defaults, kind, path)


def create(home, candidate, *, native):
    from hermes_cli.config import is_managed

    kind = candidate.get("kind")
    require(type(kind) is str and kind in _CREATE_ROLES, "invalid_setup_request")
    fields = {"kind", "path", "project_id"} if kind == "project_rel" else {"kind", "path"}
    obj(candidate, fields)
    home = profile_home(home)
    require(not is_managed(), "managed_setup")
    with profile_setup_lock(home):
        _, _, binary, defaults = _defaults(home)
        if kind == "project_rel":
            require(identifier(candidate["project_id"]) in active_projects(home), "unknown_hermes_project")
        file_kind = "phy" if kind == "phy" else "rel"
        with setup_paths.destination(home, defaults, file_kind, candidate["path"], native=native) as path:
            try:
                result = _host_setup(home, binary, "setup-create",
                                     {"role": _CREATE_ROLES[kind], "path": str(path)})
            except subprocess.CalledProcessError as exc:
                code = exc.stderr.strip().removeprefix(b"reliquary-hermes-host: ")
                if code in _CREATE_ERRORS:
                    raise ContractError(code.decode("ascii")) from None
                raise ContractError("owner_creation_unavailable") from None
            except subprocess.TimeoutExpired:
                raise ContractError("owner_creation_unconfirmed") from None
            except OSError:
                raise ContractError("owner_creation_unavailable") from None
            try:
                report = decode(result.stdout)
                _owner_report(report)
                require(report["accepted"] and report["opened"] and report["kind"] == file_kind
                        and report["owner_id"] is not None, "owner_created_unverified")
                scope = {"general_rel": "unspecified", "project_rel": "project", "phy": None}[kind]
                require(report["scope"] == scope, "owner_created_unverified")
            except ContractError:
                raise ContractError("owner_created_unverified") from None
            return {**report, "path": str(path)}


def _owners_fingerprint(state, owners):
    with (state / "owners.json").open("rb") as stream:
        raw = stream.read(MAX_WIRE_BYTES + 1)
    persisted = decode(raw)
    # Fresh settings may serialize an empty optional legacy map.
    persisted.setdefault("session_projects", {})
    require(persisted == {"session_projects": {}, **owners}, "service_restart_required")
    return hashlib.sha256(raw).hexdigest()


def _running_report(home, prior, processing, request):
    state = _state_dir(home)
    if not (state / "discovery.json").is_file():
        return None
    try:
        settings = read_settings(home)
        client = HostClient(state, settings.profile_id, settings.principal_id, read_token(home))
        client.read_dashboard_topology(None)
    except (OSError, ValueError, HostUnavailable):
        return None

    config = request["config_path"]
    changed = request["owners"] != prior or (
        config is not None and Path(config) != Path(processing.get("config_path") or "")
    )
    require(not changed, "service_restart_required")
    try:
        fingerprint = _owners_fingerprint(state, request["owners"])
        topology = client.read_dashboard_topology(None, owners_fingerprint=fingerprint)
    except (OSError, ValueError, HostUnavailable):
        raise ContractError("service_restart_required") from None

    # Signed owner bindings are in registry order: General, projects sorted by
    # stable ID, then active PHY. Scope was verified when this topology mounted.
    projects = sorted(prior["projects"])
    rows = topology["owners"]
    require(len(rows) == len(projects) + 2 and rows[-1]["owner_id"] == topology["active_phy_id"],
            "service_restart_required")
    reports = [{"accepted": True, "opened": True, "kind": row["owner_kind"].lower(),
                "owner_id": row["owner_id"], "scope": None, "error": None} for row in rows]
    return {"valid": True, "main_rel": reports[0], "active_phy": reports[-1],
            "projects": dict(zip(projects, reports[1:-1])),
            "config": {"accepted": True, "opened": config is not None, "error": None},
            "topology_error": None}


def validate(home, candidate, *, project_aware=False):
    home = profile_home(home)
    prior, processing, binary, defaults = _defaults(home)
    request = _candidate(home, candidate, prior, defaults, project_aware=project_aware)
    return _running_report(home, prior, processing, request) or _preflight(home, binary, request)


def _activate(home):
    from hermes_cli.config import save_config

    config = _activation(home)
    plugins = config.get("plugins") or {}
    enabled = list(plugins.get("enabled") or ())
    # The directory package registers its own cold hook. The Python package uses an entry point.
    directory_package = (home / "plugins/reliquary/host-pin.json").is_file()
    observer = "reliquary" if directory_package else "reliquary-source-observer"
    if observer not in (plugins.get("disabled") or ()) and observer not in enabled:
        enabled.append(observer)
    save_config({"memory": {"provider": "reliquary"}, "plugins": {"enabled": enabled}}, merge_existing=True)


def apply(home, candidate, *, project_aware=False):
    from hermes_cli.config import is_managed
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override
    from utils import atomic_json_write

    home = profile_home(home)
    state = _state_dir(home)
    scope = set_hermes_home_override(home)
    try:
        require(not is_managed(), "managed_setup")
        with profile_setup_lock(home):
            prior, processing, binary, defaults = _defaults(home)
            request = _candidate(home, candidate, prior, defaults, project_aware=project_aware)
            if _running_report(home, prior, processing, request) is not None:
                capture_cutoff(home, enroll=True)
                _activate(home)
                return {"valid": True, "configured": True}
            processing_path = state / "processing.json"
            config_path = request["config_path"]
            prior_config = processing.get("config_path")
            config_changed = config_path is not None and (
                prior_config is None or Path(prior_config) != Path(config_path)
            )
            report = _preflight(home, binary, request)
            if not report["valid"]:
                return {**report, "configured": False}

            paths = [state / "owners.json", state / "provider.json"]
            if config_changed:
                paths.append(processing_path)
            previous = {path: _read_optional(path) for path in paths}
            service_files = {path: _read_optional(path) for path in (
                state / "discovery.json", state / "topology-v1.json",
            )}
            ensure_setup_token(home)
            client = None
            try:
                if config_changed:
                    atomic_json_write(processing_path, {"config_path": config_path}, mode=0o600, fsync_dir=True)
                save_settings(home, {**request["owners"], "binary": str(binary)})
                settings = read_settings(home)
                client = HostClient(settings.state_dir, settings.profile_id, settings.principal_id,
                                    read_token(home), binary=settings.binary)
                fingerprint = _owners_fingerprint(state, request["owners"])
                try:
                    active = client.connect_dashboard(None, owners_fingerprint=fingerprint)
                except HostUnavailable as exc:
                    if str(exc) == "service_restart_required":
                        raise ContractError("service_restart_required") from None
                    raise
                expected = {report["main_rel"]["owner_id"], report["active_phy"]["owner_id"],
                            *(owner["owner_id"] for owner in report["projects"].values())}
                require({owner["owner_id"] for owner in active["owners"]} == expected
                        and active["active_phy_id"] == report["active_phy"]["owner_id"],
                        "service_restart_required")
                enrollment = state / ENROLLMENT_FILE
                new_enrollment = not enrollment.exists()
                capture_cutoff(home, enroll=True)
                if new_enrollment:
                    previous[enrollment] = {}
                _activate(home)
            except (OSError, RuntimeError, ValueError):
                if client is not None and client.cancel_startup():
                    previous.update(service_files)
                for path, value in previous.items():
                    if value:
                        atomic_json_write(path, value, mode=0o600, fsync_dir=True)
                    else:
                        path.unlink(missing_ok=True)
                raise
            return {"valid": True, "configured": True}
    finally:
        reset_hermes_home_override(scope)


def cli_setup(home):
    """Collect local choices from the Hermes CLI and report the shared result."""
    try:
        home = profile_home(home)
        defaults = status(home)["defaults"]
        print("Configure the existing Reliquary owners and local host.")
        candidate = {}
        for key, prompt in (("main_rel", "Absolute path to the existing main REL"),
                            ("active_phy", "Absolute path to the existing active PHY"),
                            ("config_path", "Reliquary config path (optional)")):
            default = defaults[key]
            label = f"{prompt} [{default}]" if default else prompt
            candidate[key] = input(f"{label}: ").strip() or default
        projects = dict(defaults["projects"])
        while project := input("Project REL ID to add or update (blank to finish): ").strip():
            identifier(project)
            projects[project] = input(f"Absolute REL path for {project}: ").strip()
        candidate["projects"] = projects
        if apply(home, candidate)["configured"]:
            print("Reliquary configured. Start a new Hermes session to attach.")
        else:
            print("Reliquary setup could not validate the selected owners or configuration.")
    except (EOFError, KeyboardInterrupt):
        print("Reliquary setup cancelled.")
    except (OSError, RuntimeError, ValueError):
        print("Reliquary setup could not validate or save this profile's configuration.")
