//! Bounded graph and community projections for dashboard-v1.
use super::*;
use reliquary_memory::{
    InspectionItem, InspectionQuery, MemoryGraphQuery, MemoryId, OwnerId, OwnerKind,
};
use serde_json::{Value, json};

const MAX_NODES: usize = 500;
const MAX_EDGES: usize = 1_000;
const MAX_DEPTH: u8 = 3;
const PAGE_LIMIT: usize = 128;

pub(crate) fn read(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    operation: &str,
    args: &Value,
    cursor: Option<&InspectionCursor>,
) -> Result<DashboardPage, DashboardError> {
    match operation {
        "ui.graph_page" => graph(instance, owner, kind, args, cursor),
        "ui.community_list" => communities(instance, owner, kind, args, cursor),
        "ui.community_members" => members(instance, owner, kind, args, cursor),
        _ => Err(DashboardError::unsupported("operation_unsupported")),
    }
}

fn graph(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    args: &Value,
    cursor: Option<&InspectionCursor>,
) -> Result<DashboardPage, DashboardError> {
    let seeds = string_array(args, "seed_ids", 50)?;
    let seed_ids = seeds
        .iter()
        .map(|id| parse_memory_id(id))
        .collect::<Result<Vec<_>, _>>()?;
    let depth = uint(args, "depth")?
        .try_into()
        .map_err(|_| DashboardError::invalid("invalid_graph_bounds"))?;
    let node_limit = usize::try_from(uint(args, "node_limit")?)
        .map_err(|_| DashboardError::invalid("invalid_graph_bounds"))?;
    let edge_limit = usize::try_from(uint(args, "edge_limit")?)
        .map_err(|_| DashboardError::invalid("invalid_graph_bounds"))?;
    if !(1..=MAX_DEPTH).contains(&depth)
        || !(1..=MAX_NODES).contains(&node_limit)
        || !(1..=MAX_EDGES).contains(&edge_limit)
        || seed_ids.len() > node_limit
    {
        return Err(DashboardError::invalid("invalid_graph_bounds"));
    }

    let community_id = optional_string(args, "community_id")?
        .map(|value| parse_digest(&value))
        .transpose()?;
    let query = InspectionQuery::MemoryGraph(MemoryGraphQuery {
        seed_ids,
        community_id,
        depth,
        node_limit,
        edge_limit,
        expected_cut: None,
    });
    let page = instance
        .inspect_owner(owner, kind, &query, cursor, 1)
        .map_err(DashboardError::product)?;
    let [InspectionItem::MemoryGraphPage(graph)] = page.items.as_slice() else {
        return Err(DashboardError::unavailable("graph_projection_unavailable"));
    };
    let cut = super::cut_id(&page.cut);
    let nodes = graph
        .nodes
        .iter()
        .map(|node| {
            json!({
                "node_id": node.id,
                "kind": "memory",
                "memory_id": node.id,
                "community_id": null,
                "label": node.title.chars().take(128).collect::<String>(),
                "origin": node.origin,
                "revision": node.revision.to_string(),
                "cut": cut,
            })
        })
        .collect::<Vec<_>>();
    let node_ids = graph
        .nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let edges = graph
        .edges
        .iter()
        .filter_map(|edge| {
            let source_id = graph_node_id(edge.edge.source)?;
            let target_id = graph_node_id(edge.edge.target)?;
            (node_ids.contains(source_id.as_str()) && node_ids.contains(target_id.as_str())).then(
                || {
                    json!({
                        "edge_id": edge.id,
                        "kind": if edge.edge.kind == reliquary_memory::RelationKind::Topical
                            && edge.edge.origin == reliquary_memory::RelationOrigin::User {
                            "user_association".to_owned()
                        } else {
                            format!("{:?}", edge.edge.kind).to_ascii_lowercase()
                        },
                        "origin": graph_origin(edge.edge.origin),
                        "source_id": source_id,
                        "target_id": target_id,
                        "revision": edge.edge.graph_version.to_string(),
                        "cut": cut,
                        "active": edge.edge.active,
                    })
                },
            )
        })
        .collect::<Vec<_>>();
    if graph.nodes.len() > node_limit
        || edges.len() > edge_limit
        || edges.len() != graph.edges.len()
        || nodes.iter().any(|node| node["cut"] != cut)
        || edges.iter().any(|edge| edge["cut"] != cut)
    {
        return Err(DashboardError::conflict("graph_projection_mismatch"));
    }
    Ok(DashboardPage {
        result: json!({
            "routing_state": "available",
            "nodes": nodes,
            "edges": edges,
            // Python maps DashboardPage.next to its opaque registry token.
            "next_cursor": null,
            "truncated": graph.truncated || page.truncated,
        }),
        cut: page.cut,
        next: page.next,
    })
}

fn communities(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    args: &Value,
    cursor: Option<&InspectionCursor>,
) -> Result<DashboardPage, DashboardError> {
    let limit = page_limit(args)?;
    let page = instance
        .inspect_owner(owner, kind, &InspectionQuery::Communities, cursor, limit)
        .map_err(DashboardError::product)?;
    if page.items.is_empty() && page.cut.community.is_none() {
        return Err(DashboardError::unavailable(
            "community_metadata_unavailable",
        ));
    }
    let generation = page
        .cut
        .community
        .ok_or_else(|| DashboardError::unavailable("community_metadata_unavailable"))?;
    let current_graph = page.cut.graph;
    let mut result = Vec::with_capacity(page.items.len());
    for item in &page.items {
        let InspectionItem::Community(community) = item else {
            return Err(DashboardError::unavailable(
                "community_projection_unavailable",
            ));
        };
        if community.generation != generation
            || !community.current
            || community.graph_version != current_graph
        {
            return Err(DashboardError::conflict("community_cut_mismatch"));
        }
        result.push(json!({
            "community_id": hex(&community.id),
            "generation": community.generation.to_string(),
            "member_count": community.member_count.to_string(),
            "name": community.name,
            "name_origin": match community.name_origin {
                reliquary_memory::CommunityNameOrigin::User => "user",
                reliquary_memory::CommunityNameOrigin::Unnamed => "unnamed",
            },
            "cursor": null,
        }));
    }
    Ok(DashboardPage {
        result: json!({
            "metadata_state": "available",
            "communities": { "items": result, "next_cursor": null, "truncated": page.truncated },
        }),
        cut: page.cut,
        next: page.next,
    })
}

fn members(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    args: &Value,
    cursor: Option<&InspectionCursor>,
) -> Result<DashboardPage, DashboardError> {
    let id = parse_digest(&string(args, "community_id")?)?;
    let expected_generation = decimal_u64(args, "expected_generation")?;
    let limit = page_limit(args)?;
    let query = InspectionQuery::CommunityMembers {
        id,
        expected_generation,
    };
    let page = instance
        .inspect_owner(owner, kind, &query, cursor, limit)
        .map_err(DashboardError::product)?;
    let mut ids = Vec::with_capacity(page.items.len());
    for item in &page.items {
        match item {
            InspectionItem::CommunityMember { id } => ids.push(hex(id)),
            _ => return Err(DashboardError::unavailable("community_members_unavailable")),
        }
    }
    if page.cut.community != Some(expected_generation) {
        return Err(DashboardError::conflict("community_generation_mismatch"));
    }
    Ok(DashboardPage {
        result: json!({
            "community_id": hex(&id),
            "generation": expected_generation.to_string(),
            "members": { "items": ids, "next_cursor": null, "truncated": page.truncated },
        }),
        cut: page.cut,
        next: page.next,
    })
}

fn string_array(args: &Value, key: &str, maximum: usize) -> Result<Vec<String>, DashboardError> {
    let values = args
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| DashboardError::invalid("invalid_graph_seeds"))?;
    if values.len() > maximum {
        return Err(DashboardError::invalid("invalid_graph_seeds"));
    }
    let mut result = Vec::with_capacity(values.len());
    for value in values {
        let value = value
            .as_str()
            .ok_or_else(|| DashboardError::invalid("invalid_graph_seeds"))?;
        parse_memory_id(value)?;
        if result.iter().any(|existing| existing == value) {
            return Err(DashboardError::invalid("duplicate_graph_seed"));
        }
        result.push(value.to_owned());
    }
    Ok(result)
}

fn string(args: &Value, key: &str) -> Result<String, DashboardError> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| DashboardError::invalid("invalid_arguments"))
}

fn optional_string(args: &Value, key: &str) -> Result<Option<String>, DashboardError> {
    match args.get(key) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(DashboardError::invalid("invalid_arguments")),
    }
}

fn uint(args: &Value, key: &str) -> Result<u64, DashboardError> {
    args.get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| DashboardError::invalid("invalid_arguments"))
}

fn page_limit(args: &Value) -> Result<usize, DashboardError> {
    let limit = usize::try_from(uint(args, "limit")?)
        .map_err(|_| DashboardError::invalid("invalid_page_limit"))?;
    if !(1..=PAGE_LIMIT).contains(&limit) {
        return Err(DashboardError::invalid("invalid_page_limit"));
    }
    Ok(limit)
}

fn decimal_u64(args: &Value, key: &str) -> Result<u64, DashboardError> {
    string(args, key)?
        .parse()
        .map_err(|_| DashboardError::invalid("invalid_generation"))
}

fn parse_memory_id(value: &str) -> Result<MemoryId, DashboardError> {
    Ok(MemoryId(parse_digest(value)?))
}

fn parse_digest(value: &str) -> Result<[u8; 32], DashboardError> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(DashboardError::invalid("invalid_id"));
    }
    let mut result = [0; 32];
    for (index, byte) in result.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .map_err(|_| DashboardError::invalid("invalid_id"))?;
    }
    Ok(result)
}

fn hex(value: &[u8]) -> String {
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn graph_node_id(node: reliquary_memory::GraphNode) -> Option<String> {
    match node {
        reliquary_memory::GraphNode::Memory(id) => Some(hex(&id)),
        reliquary_memory::GraphNode::Entity(_) => None,
    }
}

fn graph_origin(origin: reliquary_memory::RelationOrigin) -> &'static str {
    match origin {
        reliquary_memory::RelationOrigin::User => "user",
        reliquary_memory::RelationOrigin::Dream => "dream",
        _ => "source",
    }
}
