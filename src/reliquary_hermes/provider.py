"""Hermes MemoryProvider lifecycle for the authenticated local Reliquary host."""

from threading import Lock

from agent.memory_provider import MemoryProvider, spawn_context_thread

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
from .validation import ContractError, identifier, require


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

    @property
    def binding(self):
        """Return the last authenticated attachment for the current session."""
        with self._lock:
            return self._binding

    @property
    def lifecycle_status(self):
        with self._lock:
            return self._status

    @property
    def sync_status(self):
        with self._lock:
            return self._source.status if self._source is not None else self._sync_status

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
        self._binding = self._pending = self._session_id = None
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

    def _attach_pending(self):
        while True:
            with self._lock:
                if self._pending is None:
                    self._attaching = False
                    return
                generation, session_id = self._pending
                client = self._client
                self._pending = None
            try:
                binding = client.attach(session_id)
            except (HostUnavailable, OSError, ContractError):
                binding = None
            with self._lock:
                if generation == self._generation:
                    self._binding = binding
                    self._status = "attached" if binding is not None else "unavailable"
                if self._pending is None:
                    self._attaching = False
                    return

    def on_session_switch(self, new_session_id, *, parent_session_id="", reset=False, rewound=False, **kwargs):
        with self._lock:
            if self._client is None:
                return
            prior, source = self._session_id, self._source
            fence = source is not None and prior is not None and (rewound or (reset and prior == new_session_id))
            if fence:
                source.pause(prior)
            self._queue_attach(new_session_id)
        if fence:
            source.invalidate(prior)

    def on_turn_start(self, turn_number, message, **kwargs):
        with self._lock:
            # Validate the current session against the live service before claiming
            # an attachment for this turn. Overlapping ticks share the pending probe.
            if self._session_id is not None and self._client is not None and not self._attaching:
                self._queue_attach(self._session_id)

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
        # HP05 owns retrieval dispatch and prefetch. Publish tools only when they can execute.
        return []

    def shutdown(self):
        with self._lock:
            self._generation += 1
            self._pending = self._binding = self._client = self._session_id = None
            source = self._source
            self._source = self._source_profile = None
            self._status = self._sync_status = "stopped"
        if source is not None:
            source.stop()

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
