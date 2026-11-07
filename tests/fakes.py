"""Deterministic contract actors. None is a production provider, host, or durable queue."""

import json
from collections import deque
from dataclasses import dataclass

from reliquary_hermes import PINNED_HANDOFF_API_VERSION
from reliquary_hermes.authority import ProfileGrant
from reliquary_hermes.consumption import Decision, TurnScope, evaluate_handoff
from reliquary_hermes.validation import canonical, content_digest


@dataclass(frozen=True)
class ReferenceJob:
    profile_id: str
    principal_id: str
    session_id: str
    epoch: int
    egress_digest: str
    message_uids: tuple[str, ...]
    turn_author_json: bytes
    copied_egress_json: bytes


class FakeHost:
    def __init__(self, grant: ProfileGrant, *, proposed_hook_version=PINNED_HANDOFF_API_VERSION):
        self.grant = grant
        self.proposed_hook_version = proposed_hook_version
        self.receipts = set()
        self.prepared = {}
        self.available = True
        self.source_available = True
        self.active_cut = "cut-1"
        self.invalidated_manifests = set()

    def source_invalidation_notice(self, reason):
        """Simulate the required future host-only event; no authenticated wire path exists."""
        from reliquary_hermes.validation import choice
        choice(reason, {"stale", "deleted", "rewound", "unavailable"})
        self.source_available = False
        self.invalidated_manifests.update(d.manifest_digest for d in self.prepared.values())
        self.prepared.clear()

    def handoff(self, delivery, event, active_scope):
        if delivery.manifest_digest in self.invalidated_manifests:
            return Decision("source_unavailable")
        decision = evaluate_handoff(delivery, event, active_scope=active_scope,
                                    hook_api_version=self.proposed_hook_version,
                                    source_available=self.source_available, active_cut=self.active_cut)
        if decision.status == "confirmed":
            self.receipts.add(decision.receipt_key)
        return decision


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

        def is_available(self):
            return bool(self.homes)  # no host call and no network

        def initialize(self, session_id, **kwargs):
            home = kwargs["hermes_home"]
            profile = self.homes.get(home)
            if profile != self.host.grant.profile_id:
                self.status = "denied"
                self.profile_id = self.session_id = None
                self.last_recall = None
                self.host.prepared.clear()
                return
            self.profile_id, self.session_id = profile, session_id
            self.context = kwargs.get("agent_context", "primary")
            self.epoch += 1
            self.last_recall = None
            self.host.prepared.clear()
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
            if len(self.jobs) == self.jobs.maxlen:
                self.status = "backpressure"
                return
            if not messages or any(not isinstance(m.get("message_uid"), str) or not m["message_uid"] for m in messages):
                self.status = "source_unavailable"
                return
            # Already privacy-filtered provider egress; never reread an unredacted source here.
            self.jobs.append(ReferenceJob(self.profile_id, self.host.grant.principal_id, session_id, self.epoch, content_digest(messages), tuple(m["message_uid"] for m in messages),
                                          canonical(turn_author), canonical(messages)))
            self.status = "queued_not_durable"

        def prefetch(self, query, *, session_id=""):
            self.last_recall = None
            if (not self.host.available or not self.host.source_available or self.profile_id is None or
                    session_id != self.session_id):
                return ""
            entries = [d for d in self.host.prepared.values() if d.scope == self.scope()]
            if not entries:
                return ""
            delivery = entries[-1]
            self.last_recall = abc.RecallStatus("HP01 fake", len(delivery.memory_ids))
            return delivery.context

        def queue_prefetch(self, query, *, session_id=""):
            self.status = "prefetch_queued"  # never an accepted handoff

        def recall_status(self):
            return self.last_recall

        def on_session_switch(self, new_session_id, *, parent_session_id="", reset=False, rewound=False, **kwargs):
            self.session_id = new_session_id
            self.epoch += 1
            self.last_recall = None
            self.host.prepared.clear()

        def get_tool_schemas(self):
            from reliquary_hermes.tools import tool_schemas
            return tool_schemas()

        def handle_tool_call(self, tool_name, args, **kwargs):
            if kwargs.get("cancelled"):
                return json.dumps({"status": "cancelled"})
            return json.dumps({"status": "read_only", "content": self.prefetch(args.get("query", ""), session_id=self.session_id)})

        def shutdown(self):
            self.last_recall = None
            self.host.prepared.clear()
            self.profile_id = self.session_id = None
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
        self.sources[key] = {"candidate": parsed, "egress_digest": content_digest(messages),
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
        if key != active:
            return BoundImportDecision("stale_job")
        record = self.sources.get(key)
        if record is None or not record["available"] or not self.host.source_available:
            return BoundImportDecision("source_unavailable")
        messages = json.loads(job.copied_egress_json)
        if (job.egress_digest != content_digest(messages) or job.egress_digest != record["egress_digest"] or
                job.message_uids != record["uids"]):
            return BoundImportDecision("source_changed")
        if job.turn_author_json != record["author"]:
            return BoundImportDecision("source_author_mismatch")
        author = json.loads(job.turn_author_json)
        current_actor = author.get("id") if type(author) is dict else None
        current_bot = author.get("is_bot") if type(author) is dict else None
        current_verified = (type(current_actor) is str and bool(current_actor) and type(current_bot) is bool and
                            record["authenticated_actor_ids"] == (current_actor,))
        # Snapshot-level copied history is REL-only. A current turn actor is NOT
        # authority for historical/shared rows, even when independently authenticated.
        owners = (grant.rel_owner,)
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
            routes.append((uid, grant.owners_for(actor, bot) if verified else owners))
        phy = "authorized" if any(len(route) > 1 for _, route in routes) else "denied"
        digest = record["candidate"].snapshot_digest
        receipt = content_digest({"profile_id": job.profile_id, "principal_id": job.principal_id,
                                  "session_id": job.session_id, "epoch": job.epoch,
                                  "snapshot_digest": digest, "turn_author": author, "message_routes": routes})
        self.receipts.add(receipt)
        return BoundImportDecision("accepted_fixture", owners, digest, receipt, phy, tuple(routes), current_verified)
