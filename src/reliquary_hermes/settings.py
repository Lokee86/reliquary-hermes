"""Explicit profile configuration for the Hermes provider."""

from dataclasses import dataclass
from pathlib import Path
from stat import S_ISREG

from .validation import MAX_WIRE_BYTES, canonical, decode, identifier, obj, require, text

TOKEN_VAR = "RELIQUARY_HERMES_TOKEN"
OWNER_FIELDS = {"profile_id", "principal_id", "main_rel", "projects", "active_phy"}


@dataclass(frozen=True)
class Settings:
    state_dir: Path
    profile_id: str
    principal_id: str
    binary: Path


def profile_home(value) -> Path:
    require(isinstance(value, (str, Path)) and bool(value), "invalid_profile_home")
    path = Path(value)
    require(path.is_absolute() and path.is_dir(), "invalid_profile_home")
    return path.resolve()


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


def _owner_config(config: dict) -> dict:
    fields = set(config)
    require(OWNER_FIELDS <= fields <= OWNER_FIELDS | {"session_projects"}, "invalid_owner_config")
    identifier(config["profile_id"])
    identifier(config["principal_id"])
    _existing_file(config["main_rel"])
    _existing_file(config["active_phy"])
    projects = config["projects"]
    session_projects = config.get("session_projects", {})
    require(type(projects) is dict and len(projects) <= 128, "invalid_project_config")
    require(type(session_projects) is dict and len(session_projects) <= 4096, "invalid_project_config")
    for project_id, path in projects.items():
        identifier(project_id)
        _existing_file(path)
    for session_id, project_id in session_projects.items():
        identifier(session_id)
        require(identifier(project_id) in projects, "invalid_project_config")
    return config


def read_settings(home: Path) -> Settings:
    state = _state_dir(home)
    owners = _owner_config(_read_object(state / "owners.json"))
    provider = obj(_read_object(state / "provider.json"), {"binary"})
    return Settings(state, owners["profile_id"], owners["principal_id"], _existing_file(provider["binary"]))


def _profile_secret(home: Path):
    from agent.secret_scope import current_secret_scope, current_secret_scope_home, load_env_file

    scoped_home = current_secret_scope_home()
    if scoped_home is not None:
        require(profile_home(scoped_home) == home, "profile_scope_mismatch")
        token = (current_secret_scope() or {}).get(TOKEN_VAR)
        if token is not None:
            return token
    return load_env_file(home / ".env").get(TOKEN_VAR)


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

    from hermes_cli.config import require_env_writable, save_env_value
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    if _profile_secret(home) is None:
        require(not (_state_dir(home) / "discovery.json").exists(), "service_restart_required")
        scope = set_hermes_home_override(home)
        try:
            require_env_writable(TOKEN_VAR, "set")
            save_env_value(TOKEN_VAR, token_urlsafe(32))
        finally:
            reset_hermes_home_override(scope)
    read_token(home)
