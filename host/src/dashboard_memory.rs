//! Memory summaries, payloads and provenance from the authorized Root cut.

use super::{DashboardError, DashboardPage};
use reliquary_memory::{
    HERMES_COPIED_SOURCE_FORMAT, InspectionCursor, InspectionCut, InspectionItem, InspectionQuery,
    Instance, MemoryCanonicalStatus, MemoryId, MemoryListFilters, MemoryListLifecycle, OwnerId,
    OwnerKind, SourceTurn,
};
use serde_json::{Value, json};

const PAGE_LIMIT: usize = 128;
type AuthorizeSource<'a> = dyn FnMut(Option<&str>, &SourceTurn) -> Result<(), &'static str> + 'a;

pub(crate) fn read(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    operation: &str,
    args: &Value,
    cursor: Option<&InspectionCursor>,
    authorize_source: &mut AuthorizeSource<'_>,
) -> Result<DashboardPage, DashboardError> {
    match operation {
        "ui.memory_list" => memory_list(instance, owner, kind, args, cursor),
        "ui.memory_detail" => memory_detail(instance, owner, kind, args, authorize_source),
        "ui.memory_history" => history(instance, owner, kind, args, cursor),
        "ui.provenance" => provenance(instance, owner, kind, args, authorize_source),
        _ => Err(DashboardError::unsupported("memory_projection_operation")),
    }
}

fn memory_list(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    args: &Value,
    cursor: Option<&InspectionCursor>,
) -> Result<DashboardPage, DashboardError> {
    let limit = limit(args)?;
    let filters = args
        .get("filters")
        .ok_or_else(|| DashboardError::invalid("filters_required"))?;
    let query = filters
        .get("query")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if query.len() > 4096 {
        return Err(DashboardError::invalid("query_too_large"));
    }
    let filters = MemoryListFilters {
        query: query.to_owned(),
        category: optional_string(filters, "category")?,
        memory_type: optional_string(filters, "memory_type")?,
        lifecycle: match optional_string(filters, "lifecycle")?.as_deref() {
            None => None,
            Some("active") => Some(MemoryListLifecycle::Active),
            Some("retired") => Some(MemoryListLifecycle::Retired),
            Some("tombstoned") => Some(MemoryListLifecycle::Tombstoned),
            Some("superseded") => Some(MemoryListLifecycle::Superseded),
            Some("unavailable") => Some(MemoryListLifecycle::Unavailable),
            Some(_) => return Err(DashboardError::invalid("invalid_lifecycle")),
        },
        community_id: optional_id(filters, "community_id")?,
    };
    let page = instance
        .inspect_owner(
            owner,
            kind,
            &InspectionQuery::MemorySummaries(filters),
            cursor,
            limit,
        )
        .map_err(DashboardError::product)?;
    let items = page
        .items
        .iter()
        .map(memory_list_item)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(DashboardPage {
        result: json!({"items": items, "next_cursor": Value::Null, "truncated": page.truncated || page.next.is_some()}),
        cut: page.cut,
        next: page.next,
    })
}

fn memory_list_item(item: &InspectionItem) -> Result<Value, DashboardError> {
    let InspectionItem::MemoryListEntry(entry) = item else {
        return Err(DashboardError::unavailable(
            "unexpected_memory_list_projection",
        ));
    };
    Ok(json!({
        "memory_id": entry.id,
        "revision": entry.revision.to_string(),
        "body_id": entry.body_id,
        "title": entry.title.as_ref().map(|title| title.chars().take(128).collect::<String>()),
        "excerpt": entry.excerpt,
        "category": entry.category,
        "memory_type": entry.memory_type,
        "lifecycle": entry.lifecycle,
        "canonical_status": entry.canonical_status,
        "freshness": Value::Null,
        "community_id": entry.community_id,
    }))
}

fn memory_detail(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    args: &Value,
    authorize_source: &mut AuthorizeSource<'_>,
) -> Result<DashboardPage, DashboardError> {
    let id = required_id(args, "memory_id")?;
    let revision = optional_decimal(args, "revision")?;
    let query = InspectionQuery::Memory { id, revision };
    let page = instance
        .inspect_owner(owner, kind, &query, None, 1)
        .map_err(DashboardError::product)?;
    let item = page
        .items
        .first()
        .ok_or_else(|| DashboardError::unavailable("memory_unavailable"))?;
    let metadata = find_current_list_entry(instance, owner, kind, id, page.cut)?;
    let result = match item {
        InspectionItem::Memory(memory) => {
            let current = metadata.revision == memory.revision;
            // Older non-archived revisions carry their own exact payload and
            // lifecycle evidence. A terminal head never releases older bodies.
            if !current
                && (memory.archived || metadata.lifecycle == MemoryListLifecycle::Tombstoned)
            {
                return Err(DashboardError::unavailable(
                    "historical_detail_metadata_unavailable",
                ));
            }
            let lifecycle = if current {
                metadata.lifecycle
            } else if memory.payload_available {
                MemoryListLifecycle::Active
            } else {
                MemoryListLifecycle::Unavailable
            };
            let superseded_by = if lifecycle == MemoryListLifecycle::Superseded {
                Some(hex_id(
                    &super::retirement::successor(instance, owner, kind, id, page.cut)?.0,
                ))
            } else {
                None
            };
            if !memory.payload_available && lifecycle == MemoryListLifecycle::Active {
                return Err(DashboardError::unavailable("body_availability_mismatch"));
            }
            if memory.title.chars().count() > 128
                || memory.category.chars().count() > 128
                || memory.memory_type.chars().count() > 128
                || memory.content.len() > 32768
            {
                return Err(DashboardError::unavailable(
                    "memory_exceeds_dashboard_text_bounds",
                ));
            }
            let retained = exact_retained_revisions(instance, owner, kind, id, page.cut)?;
            let sources = provenance(
                instance,
                owner,
                kind,
                &json!({
                    "memory_id": memory.id, "revision": memory.revision.to_string(),
                }),
                authorize_source,
            )?;
            if sources.cut != page.cut {
                return Err(DashboardError::stale("owner_cut_changed"));
            }
            let excerpt = if current {
                metadata.excerpt
            } else {
                memory.content.chars().take(512).collect()
            };
            let canonical = if current {
                metadata.canonical_status
            } else {
                MemoryCanonicalStatus::Unknown
            };
            json!({
                "memory": {
                    "memory_id": memory.id,
                    "revision": memory.revision.to_string(),
                    "body_id": memory.body_id,
                    "title": nonempty(&memory.title),
                    "excerpt": excerpt,
                    "category": memory.category,
                    "memory_type": memory.memory_type,
                    "lifecycle": lifecycle,
                    "canonical_status": canonical,
                    "freshness": Value::Null,
                    "community_id": current.then_some(metadata.community_id).flatten(),
                },
                "body": {
                    "revision": memory.revision.to_string(),
                    "body_id": memory.body_id,
                    "availability": if memory.payload_available { "available" } else { "missing" },
                    "content": memory.payload_available.then_some(memory.content.as_str()),
                },
                "retained_revisions": retained,
                "superseded_by": superseded_by,
                "tombstone": false,
                "provenance": sources.result["sources"],
            })
        }
        InspectionItem::MemoryTerminal { revision, .. }
            if metadata.revision == *revision
                && metadata.lifecycle == MemoryListLifecycle::Tombstoned =>
        {
            json!({
                "memory": memory_list_item(&InspectionItem::MemoryListEntry(metadata))?,
                "body": {"revision": revision.to_string(), "body_id": null, "availability": "terminal", "content": null},
                "retained_revisions": [],
                "superseded_by": null,
                "tombstone": true,
                "provenance": [unavailable_source("deleted")],
            })
        }
        _ => {
            return Err(DashboardError::unavailable(
                "unexpected_memory_detail_projection",
            ));
        }
    };
    Ok(DashboardPage {
        result,
        cut: page.cut,
        next: None,
    })
}

fn history(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    args: &Value,
    cursor: Option<&InspectionCursor>,
) -> Result<DashboardPage, DashboardError> {
    let id = required_id(args, "memory_id")?;
    let query = InspectionQuery::MemoryHistory {
        id,
        memory_cut: None,
    };
    let page = instance
        .inspect_owner(owner, kind, &query, cursor, limit(args)?)
        .map_err(DashboardError::product)?;
    let mut revisions = Vec::with_capacity(page.items.len());
    for item in page.items {
        let InspectionItem::Memory(memory) = item else {
            if matches!(item, InspectionItem::MemoryTerminal { .. }) {
                return Err(DashboardError::unavailable("terminal_history_unavailable"));
            }
            return Err(DashboardError::unavailable(
                "unexpected_memory_history_projection",
            ));
        };
        // Creation time belongs to the exact Memory revision and is exposed by
        // Root provenance independently of source availability or quote ranges.
        let provenance_page = instance
            .inspect_owner(
                owner,
                kind,
                &InspectionQuery::Provenance {
                    id,
                    revision: Some(memory.revision),
                },
                None,
                1,
            )
            .map_err(DashboardError::product)?;
        if provenance_page.cut != page.cut {
            return Err(DashboardError::stale("owner_cut_changed"));
        }
        let Some(InspectionItem::Provenance(metadata)) = provenance_page.items.first() else {
            return Err(DashboardError::unavailable(
                "history_creation_time_unavailable",
            ));
        };
        if metadata.created_at_ns < 0 {
            return Err(DashboardError::unavailable(
                "history_creation_time_unavailable",
            ));
        }
        let created_at = (metadata.created_at_ns / 1_000_000).to_string();
        revisions.push(json!({
            "revision": memory.revision.to_string(), "body_id": memory.body_id,
            "availability": if memory.payload_available { "available" } else { "missing" },
            "created_at_ms": created_at, "content_digest": null,
        }));
    }
    Ok(DashboardPage {
        result: json!({"memory_id": hex_id(&id.0), "revisions": {
            "items": revisions, "next_cursor": null, "truncated": page.truncated || page.next.is_some(),
        }}),
        cut: page.cut,
        next: page.next,
    })
}

fn exact_retained_revisions(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    id: MemoryId,
    cut: InspectionCut,
) -> Result<Vec<String>, DashboardError> {
    let page = instance
        .inspect_owner(
            owner,
            kind,
            &InspectionQuery::MemoryHistory {
                id,
                memory_cut: Some(cut.memory),
            },
            None,
            PAGE_LIMIT,
        )
        .map_err(DashboardError::product)?;
    if page.cut != cut {
        return Err(DashboardError::unavailable("memory_cut_changed"));
    }
    if page.next.is_some() || page.truncated {
        return Err(DashboardError::unavailable(
            "retained_revision_window_incomplete",
        ));
    }
    page.items
        .iter()
        .map(|item| match item {
            InspectionItem::Memory(memory) => Ok(memory.revision.to_string()),
            InspectionItem::MemoryTerminal { .. } => Err(DashboardError::unavailable(
                "terminal_history_metadata_unavailable",
            )),
            _ => Err(DashboardError::unavailable(
                "unexpected_memory_history_projection",
            )),
        })
        .collect()
}

fn find_current_list_entry(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    id: MemoryId,
    cut: InspectionCut,
) -> Result<reliquary_memory::MemoryListEntry, DashboardError> {
    let query = InspectionQuery::MemorySummaries(MemoryListFilters::default());
    let mut cursor: Option<InspectionCursor> = None;
    for _ in 0..4 {
        let page = instance
            .inspect_owner(owner, kind, &query, cursor.as_ref(), PAGE_LIMIT)
            .map_err(DashboardError::product)?;
        if page.cut != cut {
            return Err(DashboardError::unavailable("memory_cut_changed"));
        }
        for item in page.items {
            let InspectionItem::MemoryListEntry(entry) = item else {
                return Err(DashboardError::unavailable(
                    "unexpected_memory_list_projection",
                ));
            };
            if entry.id == hex_id(&id.0) {
                return Ok(entry);
            }
        }
        if page.next.is_none() {
            break;
        }
        cursor = page.next;
    }
    Err(DashboardError::unavailable("memory_metadata_unavailable"))
}

fn provenance(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    args: &Value,
    authorize_source: &mut AuthorizeSource<'_>,
) -> Result<DashboardPage, DashboardError> {
    let id = required_id(args, "memory_id")?;
    let revision = required_decimal(args, "revision")?;
    let query = InspectionQuery::Provenance {
        id,
        revision: Some(revision),
    };
    let page = instance
        .inspect_owner(owner, kind, &query, None, 1)
        .map_err(DashboardError::product)?;
    let Some(InspectionItem::Provenance(provenance)) = page.items.first() else {
        return Err(DashboardError::unavailable("provenance_unavailable"));
    };
    let sources = match provenance.availability {
        reliquary_memory::SourceAvailability::Direct => {
            match (
                provenance.principal_id.as_deref(),
                provenance.source_time_ns,
            ) {
                (Some(principal), Some(ns)) if ns >= 0 && ns % 1_000_000 == 0 => vec![json!({
                    "kind": "user_origin", "principal_id": principal,
                    "created_at_ms": (ns / 1_000_000).to_string(),
                })],
                _ => vec![unavailable_source("missing")],
            }
        }
        reliquary_memory::SourceAvailability::Restricted => {
            vec![unavailable_source("unauthorized")]
        }
        reliquary_memory::SourceAvailability::Terminal => vec![unavailable_source("deleted")],
        reliquary_memory::SourceAvailability::Absent
        | reliquary_memory::SourceAvailability::Unavailable => vec![unavailable_source("missing")],
        // Root retains the accepted imported Hermes source identity and source
        // snapshot digest, but not an authoritative byte range for the grounding
        // quote. Return the real provenance and make only the range unavailable.
        reliquary_memory::SourceAvailability::Available => {
            let Some(turn) = provenance.source_turn.as_ref() else {
                return Err(DashboardError::unavailable("provenance_unavailable"));
            };
            match turn.imported.as_ref() {
                Some(imported) if imported.format == HERMES_COPIED_SOURCE_FORMAT => {
                    let profile = hermes_profile_namespace(&imported.namespace)
                        .ok_or_else(|| DashboardError::unavailable("provenance_unavailable"))?;
                    let source_revision = imported
                        .message_revision
                        .strip_prefix("hermes-snapshot-revision:")
                        .map(str::to_owned);
                    match authorize_source(provenance.source_owner_id.as_deref(), turn) {
                        Err(reason) => vec![unavailable_source(reason)],
                        Ok(()) => vec![json!({
                        "kind": "hermes_snapshot",
                        "label": "Hermes source / copied snapshot",
                        "profile_namespace": profile,
                        "session_id": imported.conversation_id,
                        "message_uid": imported.message_id,
                        "branch_id": imported.source_branch_id,
                        "source_revision": source_revision,
                        "content_digest": hex_id(&imported.source_digest),
                        "range": Value::Null,
                        })],
                    }
                }
                _ => vec![unavailable_source("missing")],
            }
        }
    };
    Ok(DashboardPage {
        result: json!({"memory_id": hex_id(&id.0), "revision": revision.to_string(), "sources": sources}),
        cut: page.cut,
        next: None,
    })
}

fn unavailable_source(reason: &str) -> Value {
    json!({"kind": "source_unavailable", "reason": reason})
}

fn hermes_profile_namespace(namespace: &str) -> Option<&str> {
    namespace
        .strip_prefix("hermes/profile/")?
        .rsplit_once("/principal-")
        .map(|(profile, _)| profile)
        .filter(|profile| !profile.is_empty() && !profile.contains('/'))
}

fn limit(args: &Value) -> Result<usize, DashboardError> {
    let value = args
        .get("limit")
        .and_then(Value::as_u64)
        .ok_or_else(|| DashboardError::invalid("invalid_limit"))? as usize;
    if !(1..=PAGE_LIMIT).contains(&value) {
        return Err(DashboardError::invalid("invalid_limit"));
    }
    Ok(value)
}

fn optional_string(args: &Value, key: &str) -> Result<Option<String>, DashboardError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(DashboardError::invalid("invalid_filter")),
    }
}

fn optional_id(args: &Value, key: &str) -> Result<Option<[u8; 32]>, DashboardError> {
    optional_string(args, key)?
        .map(|value| parse_id(&value))
        .transpose()
}

pub(super) fn required_id(args: &Value, key: &str) -> Result<MemoryId, DashboardError> {
    let value = args
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| DashboardError::invalid("invalid_memory_id"))?;
    Ok(MemoryId(parse_id(value)?))
}

fn parse_id(value: &str) -> Result<[u8; 32], DashboardError> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(DashboardError::invalid("invalid_memory_id"));
    }
    let mut bytes = [0; 32];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .map_err(|_| DashboardError::invalid("invalid_memory_id"))?;
    }
    Ok(bytes)
}

fn optional_decimal(args: &Value, key: &str) -> Result<Option<u64>, DashboardError> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => parse_decimal(value).map(Some),
        _ => Err(DashboardError::invalid("invalid_revision")),
    }
}

fn required_decimal(args: &Value, key: &str) -> Result<u64, DashboardError> {
    optional_decimal(args, key)?.ok_or_else(|| DashboardError::invalid("invalid_revision"))
}

fn parse_decimal(value: &str) -> Result<u64, DashboardError> {
    if value.is_empty()
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(DashboardError::invalid("invalid_revision"));
    }
    value
        .parse()
        .map_err(|_| DashboardError::invalid("revision_out_of_range"))
}

fn hex_id(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0xf) as usize] as char);
    }
    output
}

fn nonempty(value: &str) -> Option<&str> {
    (!value.is_empty()).then_some(value)
}
