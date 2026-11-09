"""Frozen bounded model-tool argument schemas; host owner grants are never model inputs."""


def tool_schemas() -> list[dict]:
    ident = {"type": "string", "minLength": 1, "maxLength": 128,
             "pattern": "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$"}
    query = {"type": "string", "minLength": 1, "maxLength": 4096}
    limit = {"type": "integer", "minimum": 1, "maximum": 50}
    ids = {"type": "array", "items": dict(ident), "maxItems": 50, "uniqueItems": True}
    properties = {
        "memory_query": {"query": query, "limit": limit},
        "refine_query": {"query": query, "limit": limit, "search_id": ident, "selected_ids": ids},
        "traverse_graph": {"seed_ids": {**ids, "minItems": 1}, "depth": {"type": "integer", "minimum": 1, "maximum": 3},
                           "limit": limit, "cut": ident},
    }
    descriptions = {
        "memory_query": "Search the current session's REL for relevant Memories.",
        "refine_query": "Refine a search from this turn using its search ID and returned Memory IDs.",
        "traverse_graph": "Find Memories one hop from returned seeds at the supplied cut.",
    }
    return [{"name": name, "description": descriptions[name],
             "parameters": {"type": "object", "additionalProperties": False,
                            "properties": props, "required": list(props)}} for name, props in properties.items()]
