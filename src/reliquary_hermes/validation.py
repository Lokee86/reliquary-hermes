"""Bounded, fail-closed JSON decoding shared by the frozen DTOs."""

import hashlib
import json
import re
from typing import Any

MAX_WIRE_BYTES = 262144
ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z")
DIGEST_RE = re.compile(r"[0-9a-f]{64}\Z")


class ContractError(ValueError):
    """A fixed, non-payload diagnostic safe for protocol errors."""


def require(condition: bool, code: str) -> None:
    if not condition:
        raise ContractError(code)


def obj(value: Any, keys: set[str]) -> dict:
    require(type(value) is dict and set(value) == keys, "invalid_fields")
    return value


def text(value: Any, maximum: int = 4096, *, blank: bool = False) -> str:
    require(type(value) is str, "invalid_text")
    try:
        size = len(value.encode("utf-8"))
    except UnicodeEncodeError:
        raise ContractError("invalid_utf8") from None
    require(size <= maximum and (blank or bool(value.strip())), "invalid_text")
    return value


def identifier(value: Any) -> str:
    require(type(value) is str and ID_RE.fullmatch(value) is not None, "invalid_id")
    return value


def digest(value: Any) -> str:
    require(type(value) is str and DIGEST_RE.fullmatch(value) is not None, "invalid_digest")
    return value


def integer(value: Any, minimum: int = 0, maximum: int = 1000000000) -> int:
    require(type(value) is int and minimum <= value <= maximum, "invalid_integer")
    return value


def choice(value: Any, choices: set[str]) -> str:
    require(type(value) is str and value in choices, "invalid_choice")
    return value


def sequence(value: Any, maximum: int, *, nonempty: bool = False) -> list:
    require(type(value) is list and len(value) <= maximum and (not nonempty or bool(value)), "invalid_list")
    return value


def canonical(value: Any) -> bytes:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, UnicodeEncodeError):
        raise ContractError("invalid_json") from None


def content_digest(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def _unique_object(pairs: list[tuple[str, Any]]) -> dict:
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate_field")
        result[key] = value
    return result


def _invalid_constant(_: str) -> None:
    raise ContractError("invalid_json")


def decode(raw: bytes) -> dict:
    require(type(raw) is bytes and len(raw) <= MAX_WIRE_BYTES, "wire_limit")
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_object, parse_constant=_invalid_constant)
    except ContractError:
        raise
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise ContractError("invalid_json") from None
    require(type(value) is dict, "invalid_envelope")
    return value
