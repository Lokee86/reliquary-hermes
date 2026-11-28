"""Hermes stock compressor with request-only, profile-bound Reliquary Ego context."""

import json

from agent.context_compressor import ContextCompressor
from agent.prompt_builder import DEFAULT_AGENT_IDENTITY, load_soul_md

from .client import HostClient, HostUnavailable
from .settings import ego_enabled, profile_home, read_profile_config, read_settings, read_token
from .validation import ContractError

ENGINE = "reliquary-ego"
COUNTER = "utf8-bytes-v1"
SEPARATOR = "\n\n"
MAX_QUERY_BYTES = 4096


def _block_bytes(text):
    return len(text.encode("utf-8"))


def _render(request_messages, soul, package, budget):
    prompt = request_messages[0]["content"]
    if not (prompt == soul or prompt.startswith(soul + SEPARATOR)):
        return None
    from agent.redact import redact_sensitive_text

    def safe(value):
        return redact_sensitive_text(value, force=True, redact_url_credentials=True)

    identity = package["identity"]
    if identity and safe(identity) != identity:
        identity = None
    standing = safe(package["standing_context"])
    if not identity and not standing:
        return None
    insertion = SEPARATOR + standing if standing and not prompt.endswith(SEPARATOR + standing) else ""
    if _block_bytes((identity or "") + insertion) > budget:
        return None
    updated = (identity or soul) + prompt[len(soul):] + insertion
    return [{**request_messages[0], "content": updated}, *request_messages[1:]]


class ReliquaryEgoContextEngine(ContextCompressor):
    name = ENGINE

    def __init__(self):
        # Hermes configures each cloned engine with update_model before binding
        # it to a session. The registered prototype owns no session or routes.
        self._ego_started = False
        self._ego_home = None
        self._ego_session = None
        self._ego_client = None

    def clone_for_agent(self):
        return type(self)()

    def update_model(self, model, context_length, base_url="", api_key="",
                     provider="", api_mode="", max_tokens=None):
        if not self._ego_started:
            from .provider import _availability_home
            try:
                config = read_profile_config(_availability_home())
            except (ContractError, OSError, ImportError, AttributeError):
                config = {}
            compression = config.get("compression", {})
            if not isinstance(compression, dict):
                compression = {}
            model_config = config.get("model", {})
            reservation = model_config.get("max_tokens") if isinstance(model_config, dict) else None
            ContextCompressor.__init__(
                self, model=model, base_url=base_url, api_key=api_key, provider=provider,
                api_mode=api_mode, config_context_length=context_length,
                threshold_percent=compression.get("threshold", 0.50),
                protect_first_n=compression.get("protect_first_n", 3),
                protect_last_n=compression.get("protect_last_n", 20),
                summary_target_ratio=compression.get("target_ratio", 0.20),
                abort_on_summary_failure=bool(compression.get("abort_on_summary_failure", False)),
                max_tokens=max_tokens or reservation,
                model_thresholds=getattr(self, "model_thresholds", None),
                threshold_tokens_cap=compression.get("threshold_tokens"),
                tail_mode=compression.get("tail_mode", "lean"),
                min_tail_user_messages=compression.get("min_tail_user_messages", 1),
                proactive_prune_tokens=compression.get("proactive_prune_tokens", 0),
                proactive_prune_min_result_chars=compression.get("proactive_prune_min_result_chars", 8000),
                proactive_prune_min_reclaim_tokens=compression.get("proactive_prune_min_reclaim_tokens", 4096),
            )
            self._ego_started = True
        return super().update_model(model, context_length, base_url, api_key, provider, api_mode,
                                    max_tokens=max_tokens)

    def on_session_start(self, session_id, **kwargs):
        super().on_session_start(session_id, **kwargs)
        self._ego_home = profile_home(kwargs["hermes_home"])
        self._ego_session = session_id
        self._ego_client = None

    def select_context(self, request_messages, *, conversation_messages=None,
                       incoming_message=None, budget_tokens=0):
        if not self._ego_home or not self._ego_session or budget_tokens <= 0 or not request_messages:
            return None
        first = request_messages[0]
        if first.get("role") != "system" or not isinstance(first.get("content"), str):
            return None
        try:
            if not ego_enabled(self._ego_home):
                return None
            soul = (load_soul_md(budget_tokens, home_override=self._ego_home)
                    or DEFAULT_AGENT_IDENTITY).strip()
            prompt = first["content"]
            if not (prompt == soul or prompt.startswith(soul + SEPARATOR)):
                return None
            budget = self._ego_budget(request_messages, budget_tokens)
            if budget <= 0:
                return None
            if self._ego_client is None:
                settings = read_settings(self._ego_home)
                self._ego_client = HostClient(settings.state_dir, settings.profile_id,
                                              settings.principal_id, read_token(self._ego_home))
            from agent.message_content import flatten_message_text
            query = flatten_message_text((incoming_message or {}).get("content", ""))
            query = query.encode("utf-8")[:MAX_QUERY_BYTES].decode("utf-8", "ignore")
            package = self._ego_client.ego_call("context", {
                "session_id": self._ego_session, "query": query,
                "budget": budget, "counter": COUNTER,
            })
            return _render(request_messages, soul, package, budget + len(SEPARATOR))
        except (HostUnavailable, ContractError, OSError, ValueError, KeyError, TypeError):
            return None

    def get_tool_schemas(self):
        from .ego_tools import schemas
        return schemas()

    def handle_tool_call(self, name, args, **kwargs):
        from .ego_tools import tool_call
        return tool_call(self._ego_home, self._ego_session, name, args)

    def _ego_budget(self, messages, window):
        # UTF-8 bytes bound text token cost for the wire representation. The
        # stock hook gets messages without tool schemas, so leave tool headroom.
        output = self.max_tokens
        if not output:
            from agent.gemini_native_adapter import GEMINI_DEFAULT_MAX_OUTPUT_TOKENS, is_native_gemini_base_url
            output = (GEMINI_DEFAULT_MAX_OUTPUT_TOKENS
                      if self.provider in {"gemini", "google", "google-ai-studio"}
                      or is_native_gemini_base_url(self.base_url) else 4096)
        usable = max(0, window - output)
        assembled = _block_bytes(json.dumps(messages, ensure_ascii=False, separators=(",", ":")))
        tool_allowance = min(16_384, usable // 5)
        return min(32_768, usable // 5, usable - assembled - tool_allowance) - len(SEPARATOR)


def register(context):
    register_engine = getattr(context, "register_context_engine", None)
    if callable(register_engine):
        from .provider import _availability_home
        try:
            if not ego_enabled(_availability_home()):
                return
        except (ContractError, OSError):
            return
        register_engine(ReliquaryEgoContextEngine())
        register_command = getattr(context, "register_command", None)
        if callable(register_command):
            from .ego_tools import identity_command
            register_command("identity", identity_command, description="Draft or approve a Reliquary Identity",
                             args_hint="<replacement text or approve ticket>")
