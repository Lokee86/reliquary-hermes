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
    return [{"name": name, "description": "Retrieve source content without confirming consumption.",
             "parameters": {"type": "object", "additionalProperties": False,
                            "properties": props, "required": list(props)}} for name, props in properties.items()]
