"""Hermes MemoryProvider lifecycle for the authenticated local Reliquary host."""

from threading import Event, Lock
import secrets

from agent.memory_provider import MemoryProvider, RecallStatus, spawn_context_thread

from .client import HostClient, HostUnavailable
from .settings import (
    PROMPTS,
    ensure_setup_token,
    profile_home,
    read_settings,
    read_token,
    save_settings,
    setup_defaults,
)
from .source_capture import capture_snapshot
from .source_worker import SourceWorker
from .tools import tool_schemas
from .validation import ContractError, canonical, decode, identifier, require, text


def _availability_home():
    from agent.secret_scope import current_secret_scope_home, is_multiplex_active
    from hermes_constants import get_hermes_home, get_hermes_home_override

    explicit = get_hermes_home_override() or current_secret_scope_home()
    if explicit is None and is_multiplex_active():
        raise ContractError("profile_scope_required")
    return profile_home(explicit if explicit is not None else get_hermes_home())


class ReliquaryMemoryProvider(MemoryProvider):
    name = "reliquary"

    def __init__(self):
        self._lock = Lock()
        self._client = None
        self._source = self._source_profile = None
        self._binding = None
        self._session_id = None
        self._status = "uninitialized"
        self._sync_status = "unavailable"
        self._generation = 0
        self._pending = None
        self._attaching = False
        self._runtime_lease_id = None
        self._heartbeat_stop = Event()
        self._heartbeat_thread = None
        self._shutdown_drained = False
        self._provider_nonce = secrets.token_hex(8)
        self._turn_sequence = 0
        self._scope_epoch = 0
        self._turn_id = self._make_turn_id()
        self._prefetch = None
        self._recall_status = None
        self._recall_generation = 0

    @property
    def binding(self):
        """Return the settled attachment for the current session."""
        with self._lock:
            return self._binding if self._status == "attached" else None

    @property
    def lifecycle_status(self):
        with self._lock:
            return self._status

    @property
    def sync_status(self):
        with self._lock:
            return self._source.status if self._source is not None else self._sync_status

    @property
    def runtime_lease_id(self):
        with self._lock:
            return self._runtime_lease_id

    def _heartbeat(self, client):
        while not self._heartbeat_stop.wait(15):
            try:
                client.heartbeat_runtime()
            except (HostUnavailable, OSError, ContractError):
                # A missed renewal is handled by host-side expiry and reconciliation.
                pass

    def _make_turn_id(self, sequence=None):
        sequence = self._turn_sequence if sequence is None else sequence
        return identifier(f"turn-{self._provider_nonce}-{self._scope_epoch}-{sequence}")

    def is_available(self):
        try:
            home = _availability_home()
            read_settings(home)
            read_token(home)
        except (OSError, RuntimeError, ValueError):
            return False
        return True

    def unavailable_reason(self):
        return "Configure the local Reliquary host and existing owners with hermes memory setup."

    def initialize(self, session_id, **kwargs):
        with self._lock:
            if self._status != "uninitialized":
                return
            if kwargs.get("agent_context", "primary") != "primary":
                self._status = self._sync_status = "non_primary"
                return
            try:
                home = profile_home(kwargs.get("hermes_home"))
                settings = read_settings(home)
                token = read_token(home)
                self._client = HostClient(
                    settings.state_dir, settings.profile_id, settings.principal_id, token, binary=settings.binary,
                )
                self._source = SourceWorker(settings, self._client)
                self._source_profile = settings.profile_id
            except (OSError, HostUnavailable, RuntimeError, ValueError):
                self._status = "unavailable"
                return
            self._queue_attach(session_id)

    def _queue_attach(self, session_id):
        """Replace the pending intent. The caller owns the state lock."""
        self._generation += 1
        changed_scope = self._session_id != session_id
        if changed_scope:
            self._scope_epoch += 1
            self._recall_generation += 1
            self._prefetch = None
            self._recall_status = None
            self._turn_sequence = 0
            self._turn_id = self._make_turn_id()
            self._binding = None
        self._pending = None
        self._session_id = None
        self._sync_status = "unavailable"
        try:
            self._session_id = identifier(session_id)
        except ContractError:
            self._status = "unavailable"
            return
        if self._source is not None:
            self._source.activate(self._session_id)
        self._pending = (self._generation, self._session_id)
        self._status = "connecting"
        if not self._attaching:
            self._attaching = True
            try:
                spawn_context_thread(self._attach_pending, name="reliquary-attach").start()
            except RuntimeError:
                self._attaching = False
                self._pending = None
                self._status = "unavailable"
                self._binding = None

    def _attach_pending(self):
        while True:
            with self._lock:
                if self._pending is None:
                    self._attaching = False
                    return
                generation, session_id = self._pending
                client = self._client
                self._pending = None
                lease_missing = self._runtime_lease_id is None
            lease_id = None
            try:
                binding = client.attach(session_id)
                with self._lock:
                    if self._status == "stopped":
                        continue
                if lease_missing:
                    lease_id, reconciliation = client.attach_runtime(session_id)
                else:
                    lease_id, reconciliation = client.add_runtime_scope(session_id)
            except (HostUnavailable, OSError, ContractError):
                binding = None

            with self._lock:
                stopped = self._status == "stopped"
                current_probe = generation == self._generation
                if lease_id is not None and not stopped:
                    lease_changed = self._runtime_lease_id != lease_id
                    self._runtime_lease_id = lease_id
                    if lease_changed:
                        self._scope_epoch += 1
                        self._recall_generation += 1
                        self._prefetch = self._recall_status = None
                        self._turn_id = self._make_turn_id()
                    if self._source is not None:
                        self._source.set_runtime(lease_id, reconciliation, queried_scope=session_id)
                    if self._heartbeat_thread is None:
                        self._heartbeat_thread = spawn_context_thread(
                            self._heartbeat, args=(client,), name="reliquary-runtime-heartbeat")
                        self._heartbeat_thread.start()
                if current_probe:
                    self._binding = binding
                    self._status = "attached" if binding is not None else "unavailable"
                detach_late = stopped and self._shutdown_drained and lease_id is not None
            if detach_late:
                try:
                    client.detach_runtime()
                except (HostUnavailable, OSError, ContractError):
                    pass

    def on_session_switch(self, new_session_id, *, parent_session_id="", reset=False, rewound=False, **kwargs):
        with self._lock:
            if self._client is None:
                return
            prior, source = self._session_id, self._source
            fence = source is not None and prior is not None and (rewound or (reset and prior == new_session_id))
            self._scope_epoch += 1
            self._recall_generation += 1
            self._prefetch = self._recall_status = None
            self._turn_sequence = 0
            self._turn_id = self._make_turn_id()
            self._binding = None
            if fence:
                source.pause(prior)
            self._queue_attach(new_session_id)
        if fence:
            source.invalidate(prior)

    def on_turn_start(self, turn_number, message, **kwargs):
        with self._lock:
            self._turn_sequence += 1
            self._recall_generation += 1
            self._turn_id = self._make_turn_id()
            self._recall_status = None
            # Probe every turn so a recovered host can surface fresh crash fences.
            if self._session_id is not None and self._client is not None and not self._attaching:
                self._queue_attach(self._session_id)

    def _request_bytes(self, operation, arguments, *, session_id, turn_id, request_id=None, current_turn=False):
        with self._lock:
            client = self._client
            if (client is None or self._status not in {"attached", "connecting"} or session_id != self._session_id or
                    self._binding is None or self._binding.session_id != session_id):
                raise HostUnavailable("host_not_attached")
            if current_turn and self._turn_id != turn_id:
                raise HostUnavailable("retrieval_turn_stale")
            profile = self._source_profile
            principal = client._principal_id
            epoch = self._scope_epoch
        value = {"protocol_version": 1, "request_id": request_id or f"req-{secrets.token_hex(16)}",
                 "operation": operation, "profile_id": profile, "principal_id": principal,
                 "session_id": session_id, "turn_id": turn_id, "expected_revision": None,
                 "idempotency_key": None, "arguments": arguments}
        raw = canonical(value)
        # Parse locally before this crosses the authenticated transport.
        from .protocol import Request
        Request.parse(raw)
        return client, raw, epoch

    def _run_recall(self, query, session_id, turn_id, recall_generation, prepared=None):
        client, raw, epoch = self._request_bytes("memory_query", {"query": query, "limit": 10},
                                                  session_id=session_id, turn_id=turn_id,
                                                  request_id=prepared["request_id"] if prepared else None, current_turn=True)
        if prepared is not None:
            raw = prepared["raw"]
        response = client.request(raw)
        if response.status != "ok":
            with self._lock:
                if (self._scope_epoch == epoch and self._session_id == session_id and
                        self._turn_id == turn_id and self._recall_generation == recall_generation):
                    self._recall_status = None
            return "", None
        result = decode(response.result_json)
        context = result["context"]
        recall = RecallStatus("Reliquary", len(result["memory_ids"])) if context else None
        with self._lock:
            if (self._scope_epoch != epoch or self._session_id != session_id or self._turn_id != turn_id or
                    self._recall_generation != recall_generation or
                    self._binding is None or self._binding.session_id != session_id or
                    self._status not in {"attached", "connecting"}):
                return "", None
            self._recall_status = recall
            if self._prefetch is prepared:
                self._prefetch = None
        return context, recall

    def prefetch(self, query, *, session_id=""):
        recall_generation = None
        try:
            with self._lock:
                self._recall_generation += 1
                recall_generation = self._recall_generation
                self._recall_status = None
            query = text(query)
            with self._lock:
                current_session, turn_id, pending = self._session_id, self._turn_id, self._prefetch
                if not session_id:
                    session_id = current_session or ""
                if session_id != current_session or self._status not in {"attached", "connecting"} or self._binding is None:
                    self._prefetch = self._recall_status = None
                    return ""
                if pending is not None and (pending["query"] != query or pending["session_id"] != session_id or
                                            pending["turn_id"] != turn_id or pending["epoch"] != self._scope_epoch):
                    self._prefetch = None
                    pending = None
            context, _ = self._run_recall(query, session_id, turn_id, recall_generation, pending)
            return context
        except (ContractError, HostUnavailable, OSError):
            if recall_generation is not None:
                with self._lock:
                    if self._recall_generation == recall_generation:
                        self._recall_status = None
            return ""

    def queue_prefetch(self, query, *, session_id=""):
        try:
            query = text(query)
            with self._lock:
                if not session_id:
                    session_id = self._session_id or ""
                if (not session_id or session_id != self._session_id or
                        self._status not in {"attached", "connecting"} or self._binding is None):
                    return
                target_sequence = self._turn_sequence + 1
                turn_id = self._make_turn_id(target_sequence)
                epoch = self._scope_epoch
            client, raw, _ = self._request_bytes("memory_query", {"query": query, "limit": 10},
                                                  session_id=session_id, turn_id=turn_id)
            pending = {"query": query, "session_id": session_id, "turn_id": turn_id,
                       "epoch": epoch, "raw": raw, "request_id": decode(raw)["request_id"]}
            with self._lock:
                if (self._scope_epoch != epoch or self._session_id != session_id or
                        self._status not in {"attached", "connecting"}):
                    return
                self._prefetch = pending
            spawn_context_thread(self._prepare_prefetch, args=(client, pending),
                                 name="reliquary-prefetch").start()
        except (ContractError, HostUnavailable, OSError, RuntimeError):
            with self._lock:
                self._prefetch = None

    def _prepare_prefetch(self, client, pending):
        try:
            with self._lock:
                if (self._prefetch is not pending or self._scope_epoch != pending["epoch"] or
                        self._session_id != pending["session_id"] or self._status not in {"attached", "connecting"}):
                    return
            if not client.prepare_retrieval(pending["raw"]):
                with self._lock:
                    if self._prefetch is pending:
                        self._prefetch = None
        except (HostUnavailable, ContractError, OSError):
            with self._lock:
                if self._prefetch is pending:
                    self._prefetch = None

    def recall_status(self):
        with self._lock:
            return self._recall_status

    def sync_turn(self, user_content, assistant_content, *, session_id="", messages=None, turn_author=None):
        with self._lock:
            if self._status in {"non_primary", "stopped"} or session_id != self._session_id:
                return
            source, profile = self._source, self._source_profile
            if source is None:
                return
            try:
                snapshot = capture_snapshot(profile, session_id, messages)
            except ContractError:
                source.unavailable(session_id)
                return
            source.submit(snapshot)

    def get_tool_schemas(self):
        with self._lock:
            return tool_schemas() if self._status != "non_primary" else []

    def handle_tool_call(self, tool_name, args, **kwargs):
        operation = {"memory_query": "memory_query", "refine_query": "refine_query",
                     "traverse_graph": "traverse_graph"}.get(tool_name)
        if operation is None:
            return canonical({"status": "unavailable", "code": "unknown_tool"}).decode("utf-8")
        try:
            session_id = kwargs.get("session_id") or self._session_id
            with self._lock:
                turn_id = self._turn_id
            client, raw, epoch = self._request_bytes(operation, args, session_id=session_id, turn_id=turn_id, current_turn=True)
            response = client.request(raw, recall_tool=True)
            with self._lock:
                if (self._scope_epoch != epoch or self._session_id != session_id or
                        self._turn_id != turn_id or self._binding is None or
                        self._binding.session_id != session_id or self._status not in {"attached", "connecting"}):
                    return canonical({"status": "unavailable", "code": "retrieval_scope_changed"}).decode("utf-8")
            return canonical({"status": response.status, "revision": response.revision,
                              "cut": response.cut, "result": decode(response.result_json)}).decode("utf-8")
        except (ContractError, HostUnavailable, OSError):
            return canonical({"status": "unavailable", "code": "retrieval_unavailable"}).decode("utf-8")

    def shutdown(self):
        with self._lock:
            if self._status == "stopped":
                return
            self._generation += 1
            self._shutdown_drained = False
            client = self._client
            self._pending = self._binding = self._client = self._session_id = None
            self._prefetch = self._recall_status = None
            self._recall_generation += 1
            source = self._source
            self._source = self._source_profile = None
            self._status = self._sync_status = "stopped"
        if source is not None:
            drained = source.stop()
        else:
            drained = True
        with self._lock:
            self._shutdown_drained = drained
        self._heartbeat_stop.set()
        with self._lock:
            self._runtime_lease_id = None
        if drained and client is not None:
            try:
                client.detach_runtime()
            except (HostUnavailable, OSError, ContractError):
                pass
        thread = self._heartbeat_thread
        if thread is not None:
            thread.join(timeout=2)

    def get_config_schema(self):
        return [{"key": key, "description": prompt, "required": True} for key, prompt in PROMPTS]

    def save_config(self, values, hermes_home):
        save_settings(profile_home(hermes_home), values)

    def post_setup(self, hermes_home, _config):
        """Run the supported CLI setup hook for both picker and named setup."""
        from hermes_cli.config import is_managed, save_config
        from hermes_constants import reset_hermes_home_override, set_hermes_home_override

        try:
            home = profile_home(hermes_home)
            defaults = setup_defaults(home)
            print("Configure the existing Reliquary owners and local host.")
            values = {}
            for key, prompt in PROMPTS:
                default = defaults.get(key)
                label = f"{prompt} (blank keeps current value)" if default else prompt
                value = input(f"{label}: ").strip()
                values[key] = value or default
            scope = set_hermes_home_override(home)
            try:
                require(not is_managed(), "managed_setup")
                self.save_config(values, home)
                ensure_setup_token(home)
                plugins = _config.get("plugins") or {}
                enabled = list(plugins.get("enabled") or ())
                observer = "reliquary-source-observer"
                if observer not in (plugins.get("disabled") or ()) and observer not in enabled:
                    enabled.append(observer)
                save_config({"memory": {"provider": self.name}, "plugins": {"enabled": enabled}},
                            merge_existing=True)
            finally:
                reset_hermes_home_override(scope)
        except (EOFError, KeyboardInterrupt):
            print("Reliquary setup cancelled.")
            return
        except (OSError, RuntimeError, ValueError):
            print("Reliquary setup could not validate or save this profile's configuration.")
            return
        print("Reliquary configured. Start a new Hermes session to attach.")
