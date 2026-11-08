"""Deterministic contract actors. None is a production provider, host, or durable queue."""

import json
from collections import deque
from dataclasses import dataclass
from hashlib import sha256
from itertools import count

from reliquary_hermes.authority import ProfileGrant
from reliquary_hermes.validation import (MAX_WIRE_BYTES, ContractError, canonical, choice, content_digest,
                                        identifier, require, sequence, text)
from source_lifecycle import SourceTombstones


@dataclass(frozen=True)
class TurnScope:
    profile_id: str
    principal_id: str
    session_id: str
    turn_id: str
    epoch: int


@dataclass(frozen=True)
class SelectedRecall:
    delivery_id: str
    scope: TurnScope
    source_epoch: int
    memory_ids: tuple[str, ...]
    context: str


@dataclass(frozen=True)
class ReferenceJob:
    profile_id: str
    principal_id: str
    session_id: str
    epoch: int
    source_epoch: int
    egress_digest: str
    message_uids: tuple[str, ...]
    turn_author_json: bytes
    copied_egress_json: bytes


class FakeHost:
    def __init__(self, grant: ProfileGrant):
        self.grant = grant
        self.recalls = {}
        self.available = True
        self.source_tombstones = SourceTombstones()
        self.unavailable_sources = set()
        self.source_epochs = {}
        self.binding_epochs = count(1)

    def source_invalidation_notice(self, profile_id, session_id, reason):
        """Simulate the trusted lifecycle signal without implementing its transport."""
        choice(reason, {"stale", "archived", "deleted", "rewound", "unavailable"})
        key = (profile_id, session_id)
        if reason in {"archived", "deleted"}:
            self.source_tombstones.record(profile_id, session_id, reason)
        self.unavailable_sources.add(key)
        self.source_epochs[key] = self.source_epochs.get(key, 0) + 1
        self.recalls = {
            delivery_id: recall for delivery_id, recall in self.recalls.items()
            if (recall.scope.profile_id, recall.scope.session_id) != key
        }

    def source_status(self, profile_id, session_id):
        if self.source_tombstones.is_tombstoned(profile_id, session_id):
            return "source_tombstoned"
        if not self.available or (profile_id, session_id) in self.unavailable_sources:
            return "source_unavailable"
        return "current"

    def source_epoch(self, profile_id, session_id):
        return self.source_epochs.get((profile_id, session_id), 0)


def provider_class(abc):
    class FakeProvider(abc.MemoryProvider):
        """Exercise the real ABC without registering a plugin or importing Hermes runtime."""
        name = "hp01_contract_fake"

        def __init__(self, host, homes):
            self.host = host
            self.homes = homes
            self.jobs = deque(maxlen=2)
            self.status = "uninitialized"
            self.last_recall = None
            self.epoch = 0
            self.context = "primary"
            self.profile_id = None
            self.session_id = None
            self.user_id = None

        def is_available(self):
            return bool(self.homes)  # no host call and no network

        def _clear_recall(self):
            self.last_recall = None
            if self.profile_id is not None and self.session_id is not None:
                scope = self.scope()
                self.host.recalls = {
                    delivery_id: recall for delivery_id, recall in self.host.recalls.items()
                    if recall.scope != scope
                }

        def initialize(self, session_id, **kwargs):
            home = kwargs["hermes_home"]
            profile = self.homes.get(home)
            self._clear_recall()
            self.profile_id = self.session_id = self.user_id = None
            if profile != self.host.grant.profile_id:
                self.status = "denied"
                return
            try:
                self.host.grant.rel_bindings.rel_for(session_id)
            except ContractError:
                self.status = "denied"
                return
            self.profile_id, self.session_id = profile, session_id
            self.user_id = self.host.grant.user_id
            self.context = kwargs.get("agent_context", "primary")
            self.epoch = next(self.host.binding_epochs)
            self.status = "ready"

        def scope(self, turn="turn-1"):
            return TurnScope(self.profile_id, self.host.grant.principal_id, self.session_id, turn, self.epoch)

        def sync_turn(self, user_content, assistant_content, *, session_id="", messages=None, turn_author=None):
            if self.context != "primary":
                self.status = "non_primary"
                return
            if not self.host.available or session_id != self.session_id or self.profile_id is None:
                self.status = "unavailable"
                return
            source_status = self.host.source_status(self.profile_id, session_id)
            if source_status != "current":
                self.status = source_status
                return
            if len(self.jobs) == self.jobs.maxlen:
                self.status = "backpressure"
                return
            try:
                uids = []
                for message in sequence(messages, 128, nonempty=True):
                    require(type(message) is dict, "invalid_source_message")
                    uids.append(identifier(message.get("message_uid")))
                    timestamp = message.get("timestamp")
                    require(type(timestamp) in {int, float} and 0 <= timestamp < float("inf"), "invalid_source_timestamp")
                    text(message.get("content"), 32768, blank=True)
                require(len(set(uids)) == len(uids), "duplicate_source_id")
                egress, author = canonical(messages), canonical(turn_author)
                require(len(egress) + len(author) <= MAX_WIRE_BYTES, "wire_limit")
            except (ContractError, RecursionError):
                self.status = "source_unavailable"
                return
            # Copy the already filtered callback. A source registry verifies it separately.
            self.jobs.append(ReferenceJob(
                self.profile_id, self.host.grant.principal_id, session_id, self.epoch,
                self.host.source_epoch(self.profile_id, session_id), sha256(egress).hexdigest(),
                tuple(uids), author, egress,
            ))
            self.status = "queued_not_durable"

        def _scoped_recall(self, session_id):
            if (self.profile_id is None or self.session_id is None or session_id != self.session_id or
                    self.host.source_status(self.profile_id, session_id) != "current"):
                return None
            scope = self.scope()
            source_epoch = self.host.source_epoch(self.profile_id, session_id)
            return next((result for result in reversed(self.host.recalls.values())
                         if result.scope == scope and result.source_epoch == source_epoch), None)

        def prefetch(self, query, *, session_id=""):
            self.last_recall = None
            delivery = self._scoped_recall(session_id)
            if delivery is None:
                return ""
            self.last_recall = (
                delivery.source_epoch,
                abc.RecallStatus("HP01 fake", len(delivery.memory_ids)),
            )
            return delivery.context

        def queue_prefetch(self, query, *, session_id=""):
            self.status = "prefetch_queued"

        def recall_status(self):
            if self.last_recall is None or self.host.source_status(self.profile_id, self.session_id) != "current":
                return None
            source_epoch, status = self.last_recall
            return status if source_epoch == self.host.source_epoch(self.profile_id, self.session_id) else None

        def on_session_switch(self, new_session_id, *, parent_session_id="", reset=False, rewound=False, **kwargs):
            self._clear_recall()
            self.epoch = next(self.host.binding_epochs)
            self.session_id = None
            if self.profile_id is None:
                return
            try:
                self.host.grant.rel_bindings.rel_for(new_session_id)
            except ContractError:
                self.status = "denied"
                return
            self.session_id = new_session_id

        def get_tool_schemas(self):
            from reliquary_hermes.tools import tool_schemas
            return tool_schemas()

        def handle_tool_call(self, tool_name, args, **kwargs):
            if kwargs.get("cancelled"):
                return json.dumps({"status": "cancelled"})
            delivery = self._scoped_recall(self.session_id)
            return json.dumps({"status": "ok", "content": delivery.context} if delivery else {"status": "unavailable"})

        def shutdown(self):
            self._clear_recall()
            self.profile_id = self.session_id = self.user_id = None
            self.status = "stopped"

    return FakeProvider


class FakeImports:
    """Untrusted in-memory acceptance simulation, never provenance or durability proof.

    This ledger does not consume ReferenceJobs or authenticate their source/actors.
    Its durable boolean is a test input, not a real source/import receipt.
    """
    def __init__(self):
        self.revision = 1
        self.idempotency = {}
        self.snapshots = {}

    def submit(self, request, *, durable):
        from reliquary_hermes.source import SourceSnapshot
        from reliquary_hermes.validation import content_digest
        source = SourceSnapshot.parse(json.loads(request.arguments_json))
        source.require_current()
        key = (request.profile_id, request.idempotency_key)
        fingerprint = content_digest({"operation": request.operation, "principal": request.principal_id,
                                      "session": request.session_id, "turn": request.turn_id,
                                      "arguments": json.loads(request.arguments_json)})
        previous = self.idempotency.get(key)
        if previous:
            return ("ok", previous[1]) if previous[0] == fingerprint else ("conflict", None)
        if request.expected_revision != f"host-rev-{self.revision}":
            return "conflict", None
        if not durable:
            return "unavailable", None
        source_key = (source.profile_id, source.session_id, source.branch_id, source.snapshot_digest)
        receipt = self.snapshots.get(source_key)
        if receipt is None:
            receipt = f"import-{len(self.snapshots)+1}"
            self.snapshots[source_key] = receipt
            self.revision += 1
        self.idempotency[key] = (fingerprint, receipt)
        return "ok", receipt


@dataclass(frozen=True)
class BoundImportDecision:
    status: str
    owners: tuple[str, ...] = ()
    snapshot_digest: str | None = None
    receipt_key: str | None = None
    phy_attribution: str = "denied"
    message_owners: tuple[tuple[str, tuple[str, ...]], ...] = ()
    current_author_authenticated: bool = False


class BoundSourceImporter:
    """End-to-end contract fake, NOT Hermes source authentication or durable import.

    Tests register exact filtered source fixtures out of band to model the trusted
    adapter boundary HP04 must implement. Hand-authored DTO claims cannot register
    themselves through accept_job. Historical actors remain explicitly unknown.
    """
    def __init__(self, host):
        self.host = host
        self.sources = {}
        self.receipts = set()

    def register_source_fixture(self, scope, messages, turn_author, *, authenticated_actor_ids=(),
                                authenticated_message_actors=(), available=True):
        from reliquary_hermes.source import SourceSnapshot
        normalized = [{"message_uid": m["message_uid"], "role": m["role"], "timestamp": m["timestamp"],
                       "content": m["content"], "author": m.get("author", {"id": None, "is_bot": None})} for m in messages]
        body = {"profile_id": scope.profile_id, "session_id": scope.session_id, "branch_id": None,
                "source_revision": None, "messages": normalized}
        candidate = {"authority": "hermes_source_copied_snapshot", **body,
                     "snapshot_digest": content_digest(body), "availability": "current"}
        parsed = SourceSnapshot.parse(candidate)
        key = (scope.profile_id, scope.principal_id, scope.session_id, scope.epoch)
        source_epoch = self.host.source_epoch(scope.profile_id, scope.session_id)
        self.sources[(*key, source_epoch)] = {"candidate": parsed, "egress_digest": content_digest(messages),
                             "uids": tuple(m["message_uid"] for m in messages), "author": canonical(turn_author),
                             "authenticated_actor_ids": tuple(authenticated_actor_ids),
                             "authenticated_message_actors": tuple(authenticated_message_actors), "available": available}
        return parsed

    def accept_job(self, job, active_scope):
        if type(job) is not ReferenceJob:
            return BoundImportDecision("invalid_job")
        grant = self.host.grant
        if (job.profile_id, job.principal_id) != (grant.profile_id, grant.principal_id):
            return BoundImportDecision("denied")
        key = (job.profile_id, job.principal_id, job.session_id, job.epoch)
        active = (active_scope.profile_id, active_scope.principal_id, active_scope.session_id, active_scope.epoch)
        source_status = self.host.source_status(job.profile_id, job.session_id)
        if source_status == "source_tombstoned":
            return BoundImportDecision(source_status)
        if key != active or job.source_epoch != self.host.source_epoch(job.profile_id, job.session_id):
            return BoundImportDecision("stale_job")
        record = self.sources.get((*key, job.source_epoch))
        if record is None or not record["available"] or source_status != "current":
            return BoundImportDecision("source_unavailable")
        messages = json.loads(job.copied_egress_json)
        if (job.egress_digest != content_digest(messages) or job.egress_digest != record["egress_digest"] or
                job.message_uids != record["uids"]):
            return BoundImportDecision("source_changed")
        if job.turn_author_json != record["author"]:
            return BoundImportDecision("source_author_mismatch")
        turn_author = json.loads(job.turn_author_json)
        current_actor = turn_author.get("id") if type(turn_author) is dict else None
        current_bot = turn_author.get("is_bot") if type(turn_author) is dict else None
        current_verified = (type(current_actor) is str and bool(current_actor) and type(current_bot) is bool and
                            record["authenticated_actor_ids"] == (current_actor,))
        # Snapshot-level copied history is REL-only. A current turn actor is NOT
        # authority for historical/shared rows, even when independently authenticated.
        owners = (grant.rel_bindings.rel_for(job.session_id),)
        assertions = record["authenticated_message_actors"]
        asserted = dict(assertions)
        if len(asserted) != len(assertions) or not set(asserted) <= set(job.message_uids):
            return BoundImportDecision("source_author_mismatch")
        routes = []
        for message in messages:
            author = message.get("author")
            actor = author.get("id") if type(author) is dict else None
            bot = author.get("is_bot") if type(author) is dict else None
            uid = message["message_uid"]
            # Only an exact per-message trusted source assertion can authorize PHY.
            verified = type(actor) is str and bool(actor) and type(bot) is bool and asserted.get(uid) == actor
            if uid in asserted and not verified:
                return BoundImportDecision("source_author_mismatch")
            routes.append((uid, grant.owners_for(job.session_id, actor, bot) if verified else owners))
        phy = "authorized" if any(len(route) > 1 for _, route in routes) else "denied"
        digest = record["candidate"].snapshot_digest
        receipt = content_digest({"profile_id": job.profile_id, "principal_id": job.principal_id,
                                  "session_id": job.session_id, "epoch": job.epoch,
                                  "snapshot_digest": digest, "turn_author": turn_author, "message_routes": routes})
        self.receipts.add(receipt)
        return BoundImportDecision("accepted_fixture", owners, digest, receipt, phy, tuple(routes), current_verified)
