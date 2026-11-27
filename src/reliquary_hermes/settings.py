"""Explicit profile configuration for the Hermes provider."""

from dataclasses import dataclass
from pathlib import Path
import re
from stat import S_ISREG
from threading import local
from urllib.parse import urlsplit

from .native_host import packaged_host_path
from .validation import MAX_WIRE_BYTES, canonical, decode, identifier, obj, require, text

TOKEN_VAR = "RELIQUARY_HERMES_TOKEN"
_SETUP_LOCK_HOLDER = local()
OWNER_FIELDS = {"profile_id", "principal_id", "main_rel", "projects", "active_phy"}


@dataclass(frozen=True)
class Settings:
    state_dir: Path
    profile_id: str
    principal_id: str
    binary: Path


@dataclass(frozen=True)
class NativeDecisionRoute:
    url: str
    credential_env: str


def profile_home(value) -> Path:
    require(isinstance(value, (str, Path)) and bool(value), "invalid_profile_home")
    path = Path(value)
    require(path.is_absolute() and path.is_dir(), "invalid_profile_home")
    return path.resolve()


def profile_setup_lock(home: Path):
    """Serialize setup with provider and dashboard host startup for this profile."""
    from hermes_cli.auth import _file_lock

    lock = home / ".reliquary-setup.lock"
    require(lock.resolve() == lock, "invalid_settings_path")
    return _file_lock(lock, _SETUP_LOCK_HOLDER, 20.0, "reliquary_setup_busy")


def _state_dir(home: Path) -> Path:
    state = home / "reliquary"
    require(state.resolve() == state, "invalid_state_directory")
    return state


def _read_object(path: Path) -> dict:
    require(path.resolve() == path, "invalid_settings_path")
    require(S_ISREG(path.stat().st_mode), "invalid_settings_file")
    with path.open("rb") as stream:
        return decode(stream.read(MAX_WIRE_BYTES + 1))


def _existing_file(value) -> Path:
    path = Path(text(value))
    require(path.is_absolute() and path.is_file(), "invalid_local_file")
    return path


def _owner_config(config: dict, *, verify_files: bool = True) -> dict:
    fields = set(config)
    require(OWNER_FIELDS <= fields <= OWNER_FIELDS | {"session_projects"}, "invalid_owner_config")
    identifier(config["profile_id"])
    identifier(config["principal_id"])
    def path(value):
        if verify_files:
            return _existing_file(value)
        require(Path(text(value)).is_absolute(), "invalid_local_file")

    path(config["main_rel"])
    path(config["active_phy"])
    projects = config["projects"]
    session_projects = config.get("session_projects", {})
    require(type(projects) is dict and len(projects) <= 128, "invalid_project_config")
    require(type(session_projects) is dict and len(session_projects) <= 4096, "invalid_project_config")
    for project_id, value in projects.items():
        identifier(project_id)
        path(value)
    for session_id, project_id in session_projects.items():
        identifier(session_id)
        require(identifier(project_id) in projects, "invalid_project_config")
    return config


def read_settings(home: Path) -> Settings:
    state = _state_dir(home)
    # Accepted owner paths and mounts are verified by the native registry.
    owners = _owner_config(_read_object(state / "owners.json"), verify_files=False)
    provider = obj(_read_object(state / "provider.json"), {"binary"})
    binary = packaged_host_path(home, Path(text(provider["binary"])))
    require(binary.is_absolute() and binary.is_file(), "invalid_local_file")
    return Settings(state, owners["profile_id"], owners["principal_id"], binary)


def read_profile_config(home: Path) -> dict:
    from hermes_cli.config import read_raw_config_readonly
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    scope = set_hermes_home_override(home)
    try:
        return read_raw_config_readonly()
    finally:
        reset_hermes_home_override(scope)


def ego_enabled(home: Path) -> bool:
    config = read_profile_config(home)
    context, memory = config.get("context"), config.get("memory")
    return (isinstance(context, dict) and context.get("engine") == "reliquary-ego"
            and isinstance(memory, dict) and memory.get("memory_enabled") is False
            and memory.get("user_profile_enabled") is False)


def read_native_decision_route(home: Path) -> NativeDecisionRoute | None:
    """Read literal route selectors from this Hermes profile's config.yaml."""
    reliquary = read_profile_config(home).get("reliquary", {})

    if type(reliquary) is not dict or "perception" not in reliquary:
        return None
    route = obj(reliquary["perception"], {"decisions_url", "credential_env"})
    url = text(route["decisions_url"], 2048)
    credential = text(route["credential_env"], 128)
    require(re.fullmatch(r"[A-Z][A-Z0-9_]*", credential) is not None and credential != TOKEN_VAR,
            "invalid_native_decision_route")
    require(not any(ch.isspace() or ord(ch) < 32 or ch in "?#\\" for ch in url),
            "invalid_native_decision_route")
    parsed = urlsplit(url)
    require(bool(parsed.hostname) and parsed.username is None and parsed.password is None and
            parsed.port != 0 and (parsed.scheme == "https" or
            (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "::1", "localhost"})),
            "invalid_native_decision_route")
    return NativeDecisionRoute(url, credential)


def _profile_secret(home: Path, name: str = TOKEN_VAR, *, scoped_only: bool = False):
    """Read one secret through Hermes after fencing it to the requested profile."""
    from agent.secret_scope import current_secret_scope_home, get_secret
    from hermes_constants import get_hermes_home, get_routing_process_hermes_home

    scoped_home = current_secret_scope_home()
    if scoped_home is None:
        require(profile_home(get_routing_process_hermes_home()) == home, "profile_scope_mismatch")
    active_home = scoped_home if scoped_home is not None else get_hermes_home()
    require(profile_home(active_home) == home, "profile_scope_mismatch")
    if not scoped_only:
        return get_secret(name)

    from agent.secret_scope import build_profile_secret_scope, current_secret_scope

    scope = current_secret_scope()
    if scope is None:
        # The launch profile may start its plugin before a turn has installed a scope.
        return build_profile_secret_scope(home).get(name)
    key = scope.get(name)
    return key if key is not None and get_secret(name) == key else None


def read_native_decision_key(home: Path, route: NativeDecisionRoute) -> str:
    key = _profile_secret(home, route.credential_env, scoped_only=True)
    require(type(key) is str and 0 < len(key) <= 4096 and all("!" <= ch <= "~" for ch in key),
            "inference_unavailable")
    return key


def read_token(home: Path) -> str:
    token = _profile_secret(home)
    require(type(token) is str and 32 <= len(token) <= 512, "invalid_service_token")
    require(token.isascii() and all("!" <= ch <= "~" for ch in token), "invalid_service_token")
    return token


def save_settings(home: Path, values: dict) -> None:
    from utils import atomic_json_write

    state = _state_dir(home)
    config_path = state / "owners.json"
    provider_path = state / "provider.json"
    try:
        prior = _owner_config(_read_object(config_path))
    except FileNotFoundError:
        prior = {"projects": {}, "session_projects": {}}
    config = dict(prior)
    for key in ("profile_id", "principal_id", "main_rel", "active_phy"):
        config[key] = values.get(key)
    if "projects" in values:
        config["projects"] = values["projects"]
    _owner_config(config)
    provider = {"binary": str(_existing_file(values.get("binary")))}
    require(len(canonical(config)) <= MAX_WIRE_BYTES, "invalid_owner_config")
    require(provider_path.resolve() == provider_path, "invalid_settings_path")
    try:
        prior_provider = _read_object(provider_path)
    except FileNotFoundError:
        prior_provider = None
    if config != prior or provider != prior_provider:
        require(not (state / "discovery.json").exists(), "service_restart_required")
    if config != prior:
        atomic_json_write(config_path, config, mode=0o600, fsync_dir=True)
    if provider != prior_provider:
        atomic_json_write(provider_path, provider, mode=0o600, fsync_dir=True)


def ensure_setup_token(home: Path) -> None:
    from secrets import token_urlsafe

    from agent.secret_scope import refresh_installed_secret_scope
    from hermes_cli.config import require_env_writable, save_env_value
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    if _profile_secret(home) is None:
        require(not (_state_dir(home) / "discovery.json").exists(), "service_restart_required")
        scope = set_hermes_home_override(home)
        try:
            require_env_writable(TOKEN_VAR, "set")
            save_env_value(TOKEN_VAR, token_urlsafe(32))
            refresh_installed_secret_scope(home)
        finally:
            reset_hermes_home_override(scope)
    read_token(home)
