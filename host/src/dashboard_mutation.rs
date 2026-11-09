//! Named dashboard mutations delegated to the public, cut-checked Root workflows.
use crate::dashboard::DashboardError;
use reliquary_memory::{
    CommunityRenameRequest, CorrectMemoryRequest, CreateMemoryRequest, InspectionCut, Instance,
    MemoryAssociationAction, MemoryAssociationRequest, MemoryBodyId, MemoryId,
    MemoryRetirementRequest, OwnerId, WorkspaceManagement,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub(crate) struct DashboardMutation {
    pub(crate) committed: Value,
    pub(crate) cut: InspectionCut,
    pub(crate) receipt_id: String,
    pub(crate) changed: bool,
}

pub(crate) fn write(
    instance: &Instance,
    owner: OwnerId,
    operation: &str,
    args: &Value,
    expected: InspectionCut,
    expected_revision: Option<&str>,
    _request_id: &str,
    idempotency_key: &str,
    principal_id: &str,
) -> Result<DashboardMutation, DashboardError> {
    if expected.owner_id != owner.as_bytes() || instance.principal() != principal_id {
        return Err(DashboardError::denied("dashboard_actor_mismatch"));
    }
    let manager: WorkspaceManagement = instance
        .workspace_management(owner)
        .map_err(DashboardError::product)?;
    let root_request_id = idempotency_key;
    match operation {
        "ui.relation_change" => {
            let source_id = memory_id(args, "source_id")?;
            let target_id = memory_id(args, "target_id")?;
            let source_revision = decimal(args, "source_revision")?;
            let target_revision = decimal(args, "target_revision")?;
            let action = match string(args, "action")? {
                "link" => MemoryAssociationAction::Link,
                "unlink" => MemoryAssociationAction::Unlink,
                _ => return Err(DashboardError::invalid("invalid_relation_action")),
            };
            let expected_edge_id = optional_string(args, "edge_id")?.map(str::to_owned);
            let edge_revision = match (expected_edge_id.is_some(), expected_revision) {
                (false, None) => None,
                (true, Some(value)) => Some(parse_decimal(value)?),
                _ => return Err(DashboardError::invalid("invalid_relation_revision")),
            };
            let receipt = manager
                .change_memory_association(
                    expected,
                    MemoryAssociationRequest {
                        request_id: root_request_id.to_owned(),
                        source_id,
                        target_id,
                        source_revision,
                        target_revision,
                        expected_edge_id,
                        expected_edge_revision: edge_revision,
                        action,
                    },
                )
                .map_err(DashboardError::product)?;
            let edge = receipt.edge;
            let source = match edge.edge.source {
                reliquary_memory::GraphNode::Memory(id) => hex(&id),
                _ => {
                    return Err(DashboardError::unavailable(
                        "association_endpoint_unavailable",
                    ));
                }
            };
            let target = match edge.edge.target {
                reliquary_memory::GraphNode::Memory(id) => hex(&id),
                _ => {
                    return Err(DashboardError::unavailable(
                        "association_endpoint_unavailable",
                    ));
                }
            };
            let committed = json!({
                "edge_id": edge.id,
                "kind": "user_association",
                "origin": match edge.edge.origin {
                    reliquary_memory::RelationOrigin::User => "user",
                    reliquary_memory::RelationOrigin::Dream => "dream",
                    _ => "source",
                },
                "source_id": source, "target_id": target,
                "revision": edge.edge.graph_version.to_string(),
                "cut": super::cut_id(&receipt.cut), "active": edge.edge.active,
            });
            // Root rejects a first-time request that leaves an edge in its prior
            // state. Thus every accepted request represents a transition; exact
            // replay reports the same committed effect.
            Ok(DashboardMutation {
                committed,
                cut: receipt.cut,
                receipt_id: stable_receipt_id(principal_id, owner, operation, root_request_id),
                changed: true,
            })
        }
        "ui.community_rename" => {
            let revision = expected_revision
                .ok_or_else(|| DashboardError::invalid("missing_community_revision"))?;
            let community_id = digest(args, "community_id")?;
            let name = string(args, "name")?.to_owned();
            let receipt = manager
                .rename_community_at_cut(
                    expected,
                    CommunityRenameRequest {
                        request_id: root_request_id.to_owned(),
                        community_id,
                        expected_generation: parse_decimal(revision)?,
                        name,
                    },
                )
                .map_err(DashboardError::product)?;
            let community = receipt.community;
            let committed = json!({
                "community_id": hex(&community.id),
                "generation": community.generation.to_string(),
                "member_count": community.member_count.to_string(),
                "name": community.name,
                "name_origin": match community.name_origin {
                    reliquary_memory::CommunityNameOrigin::User => "user",
                    reliquary_memory::CommunityNameOrigin::Unnamed => "unnamed",
                },
                "cursor": null,
            });
            Ok(DashboardMutation {
                committed,
                cut: receipt.cut,
                receipt_id: stable_receipt_id(principal_id, owner, operation, root_request_id),
                changed: receipt.changed,
            })
        }
        "ui.memory_create" => {
            let created_at_ns = decimal(args, "created_at_ns")?;
            if created_at_ns % 1_000_000 != 0 {
                return Err(DashboardError::invalid(
                    "created_at_not_millisecond_aligned",
                ));
            }
            let receipt = manager
                .create_memory_at_cut(
                    expected,
                    CreateMemoryRequest {
                        request_id: root_request_id.to_owned(),
                        title: string(args, "title")?.to_owned(),
                        content: string(args, "body")?.to_owned(),
                        category: string(args, "category")?.to_owned(),
                        memory_type: string(args, "memory_type")?.to_owned(),
                        created_at_ns: i64::try_from(created_at_ns)
                            .map_err(|_| DashboardError::invalid("invalid_created_at"))?,
                    },
                )
                .map_err(DashboardError::product)?;
            let summary = receipt.memory;
            let committed = memory_detail(
                summary.id,
                summary.revision,
                summary.body_id,
                &summary.title,
                &summary.content,
                &summary.category,
                &summary.memory_type,
                created_at_ns,
                principal_id,
            );
            Ok(DashboardMutation {
                committed,
                cut: receipt.cut,
                receipt_id: stable_receipt_id(principal_id, owner, operation, root_request_id),
                changed: true,
            })
        }
        "ui.memory_edit" => {
            let created_at_ns = decimal(args, "created_at_ns")?;
            if created_at_ns % 1_000_000 != 0 {
                return Err(DashboardError::invalid(
                    "created_at_not_millisecond_aligned",
                ));
            }
            let expected_body_id = MemoryBodyId(digest(args, "expected_body_id")?);
            let revision = parse_decimal(
                expected_revision
                    .ok_or_else(|| DashboardError::invalid("missing_memory_revision"))?,
            )?;
            let receipt = manager
                .correct_memory_at_cut(
                    expected,
                    CorrectMemoryRequest {
                        request_id: root_request_id.to_owned(),
                        memory_id: memory_id(args, "memory_id")?,
                        expected_revision: revision,
                        expected_body_id,
                        title: string(args, "title")?.to_owned(),
                        content: string(args, "body")?.to_owned(),
                        created_at_ns: i64::try_from(created_at_ns)
                            .map_err(|_| DashboardError::invalid("invalid_created_at"))?,
                    },
                )
                .map_err(DashboardError::product)?;
            let replacement = receipt.replacement;
            let replacement_detail = memory_detail(
                replacement.id,
                replacement.revision,
                replacement.body_id,
                &replacement.title,
                &replacement.content,
                &replacement.category,
                &replacement.memory_type,
                created_at_ns,
                principal_id,
            );
            let committed = json!({
                "original_memory_id": receipt.original_memory_id,
                "original_revision": receipt.original_revision.to_string(),
                "replacement": replacement_detail,
            });
            Ok(DashboardMutation {
                committed,
                cut: receipt.cut,
                receipt_id: stable_receipt_id(principal_id, owner, operation, root_request_id),
                changed: true,
            })
        }
        "ui.memory_retire" => {
            if string(args, "effect")? != "retire" {
                return Err(DashboardError::invalid("invalid_retirement"));
            }
            let evidence: super::intent::RetirementEvidence =
                serde_json::from_value(args["retirement"].clone())
                    .map_err(|_| DashboardError::unavailable("retirement_evidence_unavailable"))?;
            let memory_revision = parse_decimal(
                expected_revision
                    .ok_or_else(|| DashboardError::invalid("missing_memory_revision"))?,
            )?;
            let receipt = manager
                .retire_memory_at_cut(
                    expected,
                    root_request_id,
                    MemoryRetirementRequest {
                        owner_id: owner.as_bytes(),
                        memory_id: memory_id(args, "memory_id")?,
                        memory_revision,
                        body_id: MemoryBodyId(parse_digest(&evidence.body_id)?),
                        superseded_by: MemoryId(evidence.successor_id),
                        successor_revision: evidence.successor_revision,
                        successor_body_id: MemoryBodyId(parse_digest(&evidence.successor_body_id)?),
                    },
                )
                .map_err(DashboardError::product)?;
            Ok(DashboardMutation {
                committed: json!({"memory_id": receipt.memory_id, "revision": receipt.revision.to_string(), "lifecycle": "tombstoned"}),
                cut: receipt.cut,
                receipt_id: stable_receipt_id(principal_id, owner, operation, root_request_id),
                changed: true,
            })
        }
        _ => Err(DashboardError::unsupported("operation_unavailable")),
    }
}

fn stable_receipt_id(principal: &str, owner: OwnerId, operation: &str, key: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"reliquary:dashboard-receipt:v1\0");
    let owner_id = owner.to_string();
    for field in [
        principal.as_bytes(),
        owner_id.as_bytes(),
        operation.as_bytes(),
        key.as_bytes(),
    ] {
        digest.update((field.len() as u64).to_le_bytes());
        digest.update(field);
    }
    hex(&digest.finalize())
}

fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, DashboardError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| DashboardError::invalid("invalid_arguments"))
}

fn optional_string<'a>(value: &'a Value, key: &str) -> Result<Option<&'a str>, DashboardError> {
    match value.get(key) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text)),
        _ => Err(DashboardError::invalid("invalid_arguments")),
    }
}

fn decimal(value: &Value, key: &str) -> Result<u64, DashboardError> {
    parse_decimal(string(value, key)?)
}

fn parse_decimal(value: &str) -> Result<u64, DashboardError> {
    if value.is_empty()
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(DashboardError::invalid("invalid_revision"));
    }
    value
        .parse()
        .map_err(|_| DashboardError::invalid("revision_out_of_range"))
}

fn memory_id(value: &Value, key: &str) -> Result<reliquary_memory::MemoryId, DashboardError> {
    Ok(reliquary_memory::MemoryId(digest(value, key)?))
}

fn digest(value: &Value, key: &str) -> Result<[u8; 32], DashboardError> {
    parse_digest(string(value, key)?)
}

fn parse_digest(text: &str) -> Result<[u8; 32], DashboardError> {
    if text.len() != 64 || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(DashboardError::invalid("invalid_id"));
    }
    let mut bytes = [0; 32];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&text[index * 2..index * 2 + 2], 16)
            .map_err(|_| DashboardError::invalid("invalid_id"))?;
    }
    Ok(bytes)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn memory_detail(
    id: String,
    revision: u64,
    body_id: String,
    title: &str,
    content: &str,
    category: &str,
    memory_type: &str,
    created_at_ns: u64,
    principal_id: &str,
) -> Value {
    let excerpt_end = content
        .char_indices()
        .map(|(index, ch)| (index, ch))
        .take_while(|(index, ch)| index + ch.len_utf8() <= 512)
        .last()
        .map_or(0, |(index, ch)| index + ch.len_utf8());
    let created_at_ms = (created_at_ns / 1_000_000).to_string();
    json!({
        "memory": {
            "memory_id": id, "revision": revision.to_string(), "body_id": body_id,
            "title": title, "excerpt": &content[..excerpt_end], "category": category,
            "memory_type": memory_type, "lifecycle": "active", "canonical_status": "unknown",
            "freshness": null, "community_id": null,
        },
        "body": {
            "revision": revision.to_string(), "body_id": body_id,
            "availability": "available", "content": content,
        },
        "retained_revisions": [revision.to_string()], "superseded_by": null,
        "tombstone": false,
        "provenance": [{"kind": "user_origin", "principal_id": principal_id, "created_at_ms": created_at_ms}],
    })
}
