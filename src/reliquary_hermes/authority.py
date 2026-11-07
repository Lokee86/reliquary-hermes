"""Server-owned grants and profile-scoped authorization, with no caller owner IDs."""

import hmac
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from . import HERMES_REVISION, PINNED_HANDOFF_API_VERSION
from .protocol import OPERATIONS, Request
from .validation import identifier, require, text


@dataclass(frozen=True)
class AuthorGrant:
    actor_id: str
    phy_owner: str


@dataclass(frozen=True)
class ProfileGrant:
    profile_id: str
    principal_id: str
    rel_owner: str
    author_grants: tuple[AuthorGrant, ...] = ()
    credential: str = field(default="", repr=False, compare=False)
    allowed_operations: tuple[str, ...] = tuple(sorted(OPERATIONS - {"edit_memory", "consumption_confirm"}))

    def __post_init__(self) -> None:
        for v in (self.profile_id, self.principal_id, self.rel_owner):
            identifier(v)
        require(type(self.author_grants) is tuple, "invalid_grants")
        require(len(self.author_grants) <= 128, "invalid_grants")
        for g in self.author_grants:
            require(type(g) is AuthorGrant, "invalid_grants")
            identifier(g.actor_id)
            identifier(g.phy_owner)
        require(len({g.actor_id for g in self.author_grants}) == len(self.author_grants), "duplicate_actor")
        require(type(self.allowed_operations) is tuple and set(self.allowed_operations) <= OPERATIONS, "invalid_capabilities")
        # Host provisioning supplies a high-entropy credential. Never generate it from an ID.
        text(self.credential, 512)
        require(len(self.credential) >= 32 and self.credential.isascii(), "invalid_credential")

    def authorize(self, request: Request, credential: str) -> None:
        require(type(credential) is str and credential.isascii() and len(credential) <= 512, "denied")
        require(hmac.compare_digest(self.credential, credential), "denied")
        require((request.profile_id, request.principal_id) == (self.profile_id, self.principal_id), "denied")
        # This is a provider-channel grant, never authenticated interactive UI authority.
        require(request.operation != "edit_memory", "user_channel_required")
        if request.operation == "consumption_confirm":
            require(PINNED_HANDOFF_API_VERSION == 1, "handoff_unavailable")
        require(request.operation in self.allowed_operations, "denied")

    def owners_for(self, actor_id: str | None, is_bot: bool | None) -> tuple[str, ...]:
        # Call only with trusted host-authenticated actor metadata, never a model/DTO claim.
        # Authenticated per-author mapping may explicitly cover a bot; no implicit operator PHY.
        mapped = next((g.phy_owner for g in self.author_grants if actor_id is not None and g.actor_id == actor_id), None)
        return (self.rel_owner, mapped) if mapped is not None else (self.rel_owner,)


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
