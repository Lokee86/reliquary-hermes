"""Bounded owner assignment data returned by the native setup service."""

from pathlib import Path

from .validation import identifier, integer, obj, require, text

ROLES = {"main_rel", "active_phy"}
MAX_GENERATION = (1 << 53) - 1


def _owner_id(value):
    value = identifier(value)
    require(len(value) == 32 and all(char in "0123456789abcdef" for char in value),
            "invalid_setup_response")
    return value


def _owner(value):
    owner = obj(value, {"path", "owner_id"})
    require(Path(text(owner["path"])).is_absolute(), "invalid_setup_response")
    _owner_id(owner["owner_id"])
    return owner


def _roles(value, *, partial):
    require(type(value) is dict and "projects" in value and set(value) <= ROLES | {"projects"},
            "invalid_setup_response")
    if not partial:
        obj(value, ROLES | {"projects"})
    projects = value["projects"]
    require(type(projects) is dict and len(projects) <= 128, "invalid_setup_response")
    result = {"projects": {identifier(key): _owner(owner) for key, owner in projects.items()}}
    for role in ROLES:
        if not partial or value.get(role) is not None:
            result[role] = _owner(value[role])
    return result


def switch_status(value):
    status = obj(value, {"generation", "owners", "legacy_phy_id"})
    integer(status["generation"], maximum=MAX_GENERATION)
    _owner_id(status["legacy_phy_id"])
    return {**status, "owners": _roles(status["owners"], partial=False)}


def switch_review(value):
    review = obj(value, {"generation", "changes"})
    integer(review["generation"], maximum=MAX_GENERATION)
    return {**review, "changes": _roles(review["changes"], partial=True)}
