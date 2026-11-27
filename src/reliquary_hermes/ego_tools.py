"""Session-scoped Ego tool and Identity command adapters for stock Hermes."""

from .client import HostClient, HostUnavailable
from .settings import ego_enabled, read_settings, read_token
from .validation import ContractError, canonical

_PRIORITY = ("Low", "Normal", "High")
_SCOPE = {"type": "string", "enum": ["rel", "phy"]}
_PIN_ID = {"type": "string", "pattern": "^[0-9a-f]{32}$"}
_REVISION = {"type": "integer", "minimum": 1}
_TEXT = {"type": "string", "minLength": 1, "maxLength": 2500}
_PRIORITY_SCHEMA = {"type": "string", "enum": list(_PRIORITY)}


def schemas():
    specs = (
        ("lookup_anchors", "Look up saved Pins, including those left out of the prompt, in the explicitly selected REL or PHY.",
         {"scope": _SCOPE, "query": _TEXT}, ["scope"]),
        ("pin_anchor", "Save a standing instruction in the explicitly selected REL or PHY after the user asks.",
         {"scope": _SCOPE, "text": _TEXT, "priority": _PRIORITY_SCHEMA}, ["scope", "text"]),
        ("modify_anchor", "Update the selected Pin at its current revision. For a clear reaffirmation or softening, change only priority by one tier. Use an explicitly requested priority when supplied.",
         {"scope": _SCOPE, "id": _PIN_ID, "revision": _REVISION, "text": _TEXT, "priority": _PRIORITY_SCHEMA,
          "adjust_priority": {"type": "string", "enum": ["reaffirm", "soften"]}}, ["scope", "id", "revision"]),
        ("delete_anchor", "Remove the identified Pin from its explicit REL or PHY scope at the supplied current revision.",
         {"scope": _SCOPE, "id": _PIN_ID, "revision": _REVISION}, ["scope", "id", "revision"]),
    )
    return [{"name": name, "description": description,
             "parameters": {"type": "object", "properties": properties,
                            "required": required, "additionalProperties": False}}
            for name, description, properties, required in specs]


def profile_client(home):
    if not ego_enabled(home):
        raise HostUnavailable("ego_profile_not_enabled")
    settings = read_settings(home)
    return HostClient(settings.state_dir, settings.profile_id, settings.principal_id, read_token(home))


def tool_call(home, session, tool, arguments):
    try:
        if home is None or session is None:
            raise HostUnavailable("ego_session_unavailable")
        client = profile_client(home)
        scopes = client.ego_call("scopes", {"session_id": session})
        scope = arguments["scope"]
        if scope not in {"rel", "phy"}:
            raise ValueError("scope")
        body = {"scope": scope, "owner_id": scopes[scope], "session_id": session}
        if tool == "lookup_anchors":
            pins = client.ego_call("pins", {**body, "query": arguments.get("query")})["pins"]
            result = {"scope": scope, "owner_id": body["owner_id"], "pins": [
                {**pin, "id": bytes(pin["id"]).hex()} for pin in pins
            ]}
        elif tool == "pin_anchor":
            result = client.ego_call("pin_create", {**body, "text": arguments["text"],
                                                   "priority": arguments.get("priority")})
        elif tool in {"modify_anchor", "delete_anchor"}:
            pin_id = list(bytes.fromhex(arguments["id"]))
            revision = arguments["revision"]
            patch = {**body, "id": pin_id, "revision": revision}
            if tool == "modify_anchor":
                priority = arguments.get("priority")
                adjustment = arguments.get("adjust_priority")
                if priority is None and adjustment is not None:
                    pins = client.ego_call("pins", {**body, "id": pin_id})["pins"]
                    current = next((pin for pin in pins if pin["id"] == pin_id and pin["revision"] == revision), None)
                    if current is None:
                        raise HostUnavailable("ego_pin_revision_changed")
                    direction = {"reaffirm": 1, "soften": -1}[adjustment]
                    position = _PRIORITY.index(current["priority"])
                    priority = _PRIORITY[max(0, min(2, position + direction))]
                    if priority == current["priority"] and "text" not in arguments:
                        return canonical({"owner_id": body["owner_id"], "pin": {
                            **current, "id": bytes(current["id"]).hex()}}).decode()
                result = client.ego_call("pin_modify", {**patch, "text": arguments.get("text"), "priority": priority})
            else:
                result = client.ego_call("pin_delete", patch)
        else:
            raise ValueError("tool")
        if result.get("pin") is not None:
            result["pin"]["id"] = bytes(result["pin"]["id"]).hex()
            result["owner_id"] = body["owner_id"]
        return canonical(result).decode()
    except (ContractError, HostUnavailable, OSError, TypeError, ValueError, KeyError):
        return canonical({"status": "unavailable", "code": "ego_tool_unavailable"}).decode()


def identity_command(raw_args, *, session_id=None, **_kwargs):
    from .provider import _availability_home

    try:
        client = profile_client(_availability_home())
        text = raw_args.strip()
        if text.startswith("approve "):
            client.ego_call("identity_approve", {"session_id": session_id, "ticket": text[8:].strip()})
            return "Saved the approved Identity revision."
        if not text:
            return "Use /identity followed by the replacement text for the active Identity."
        preview = client.ego_call("identity_prepare", {"session_id": session_id, "text": text})
        return (
            f"Identity draft for {preview['draft']['name']} at revision {preview['draft']['revision']}\n\n"
            f"{preview['draft']['text']}\n\n"
            f"To save this text, enter /identity approve {preview['ticket']}."
        )
    except (ContractError, HostUnavailable, OSError, TypeError, ValueError, KeyError):
        return "Identity could not be changed. Check the active Identity in Reliquary’s Inspector."
