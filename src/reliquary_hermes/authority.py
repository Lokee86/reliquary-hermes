"""Server-owned grants and profile-scoped authorization, with no caller owner IDs."""

import hmac
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from . import HERMES_REVISION
from .protocol import OPERATIONS, Request
from .validation import ContractError, identifier, require, text


@dataclass(frozen=True)
class ActivePhy:
    """A trusted service selection and its independently verified human actor."""

    owner_id: str
    actor_id: str

    def __post_init__(self) -> None:
        identifier(self.owner_id)
        identifier(self.actor_id)


@dataclass(frozen=True)
class ProjectRel:
    project_id: str
    owner_id: str

    def __post_init__(self) -> None:
        identifier(self.project_id)
        identifier(self.owner_id)


@dataclass(frozen=True)
class SessionRel:
    session_id: str
    project_id: str | None = None

    def __post_init__(self) -> None:
        identifier(self.session_id)
        if self.project_id is not None:
            identifier(self.project_id)


@dataclass(frozen=True)
class RelBindings:
    """Server-owned snapshot of REL topology and configured session bindings.

    Every project owner is a direct child of main_rel. HP03 persists the
    underlying bindings and validates the mounted owners against this topology.
    """

    main_rel: str
    sessions: tuple[SessionRel, ...]
    projects: tuple[ProjectRel, ...] = ()

    def __post_init__(self) -> None:
        identifier(self.main_rel)
        require(type(self.projects) is tuple and all(type(p) is ProjectRel for p in self.projects), "invalid_projects")
        require(type(self.sessions) is tuple and all(type(s) is SessionRel for s in self.sessions), "invalid_sessions")
        projects = {p.project_id: p.owner_id for p in self.projects}
        require(len(projects) == len(self.projects), "duplicate_project")
        require(len(set(projects.values()) | {self.main_rel}) == len(projects) + 1, "duplicate_rel")
        require(len({s.session_id for s in self.sessions}) == len(self.sessions), "duplicate_session")
        require(all(s.project_id is None or s.project_id in projects for s in self.sessions), "unknown_project")

    def rel_for(self, session_id: str) -> str:
        for binding in self.sessions:
            if binding.session_id == session_id:
                if binding.project_id is None:
                    return self.main_rel
                return next(p.owner_id for p in self.projects if p.project_id == binding.project_id)
        raise ContractError("unbound_session")


@dataclass(frozen=True)
class ProfileGrant:
    profile_id: str
    principal_id: str
    rel_bindings: RelBindings
    active_phy: ActivePhy
    credential: str = field(default="", repr=False, compare=False)
    allowed_operations: tuple[str, ...] = tuple(sorted(OPERATIONS - {"edit_memory"}))

    def __post_init__(self) -> None:
        identifier(self.profile_id)
        identifier(self.principal_id)
        require(type(self.rel_bindings) is RelBindings, "invalid_rel_bindings")
        require(type(self.active_phy) is ActivePhy, "invalid_active_phy")
        rels = {self.rel_bindings.main_rel, *(project.owner_id for project in self.rel_bindings.projects)}
        require(self.active_phy.owner_id not in rels, "invalid_active_phy")
        require(type(self.allowed_operations) is tuple and set(self.allowed_operations) <= OPERATIONS, "invalid_capabilities")
        # Host provisioning supplies a high-entropy credential. Never generate it from an ID.
        text(self.credential, 512)
        require(len(self.credential) >= 32 and self.credential.isascii(), "invalid_credential")

    @property
    def user_id(self) -> str:
        return self.active_phy.owner_id

    def authorize(self, request: Request, credential: str) -> None:
        require(type(credential) is str and credential.isascii() and len(credential) <= 512, "denied")
        require(hmac.compare_digest(self.credential, credential), "denied")
        require((request.profile_id, request.principal_id) == (self.profile_id, self.principal_id), "denied")
        # This is a provider-channel grant, never authenticated interactive UI authority.
        require(request.operation != "edit_memory", "user_channel_required")
        require(request.operation in self.allowed_operations, "denied")
        self.rel_bindings.rel_for(request.session_id)

    def owners_for(self, session_id: str, actor_id: str | None, is_bot: bool | None) -> tuple[str, ...]:
        """Route only host-authenticated row attribution to the selected PHY."""
        rel = self.rel_bindings.rel_for(session_id)
        if is_bot is False and actor_id == self.active_phy.actor_id:
            return rel, self.user_id
        return (rel,)


@dataclass(frozen=True)
class Discovery:
    endpoint: str
    instance_id: str
    profile_id: str
    protocol_version: int
    hermes_revision: str
    lease_id: str

    def validate(self, *, expected_profile: str, expected_instance: str, expected_lease: str) -> None:
        try:
            url = urlsplit(self.endpoint)
            valid = (url.scheme == "http" and url.hostname in {"127.0.0.1", "::1"} and
                     url.username is None and url.password is None and not url.query and not url.fragment and
                     url.path in {"", "/"} and url.port is not None and 1 <= url.port <= 65535)
        except (TypeError, ValueError, AttributeError):
            valid = False
        require(valid, "invalid_endpoint")
        require(type(self.protocol_version) is int and self.protocol_version == 1, "unsupported_protocol")
        require(self.hermes_revision == HERMES_REVISION, "unsupported_host")
        for v in (self.profile_id, self.instance_id, self.lease_id):
            identifier(v)
        require((self.profile_id, self.instance_id, self.lease_id) ==
                (expected_profile, expected_instance, expected_lease), "discovery_mismatch")
