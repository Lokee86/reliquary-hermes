//! Signed local request assembly and authorized Ego controls.

use crate::{
    registry::{Registry, RegistryError, owner_error},
    service_protocol::{decode, valid_id},
};
use reliquary_memory::{
    EgoIdentityDraft, EgoIdentityId, EgoPinId, EgoPinPatch, EgoPinPriority, EgoScope,
    EgoSummaryEdit, OwnerId, PreparedEgoIdentity,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

const INVALID: RegistryError = RegistryError::Invalid("invalid_ego_request");
const DENIED: RegistryError = RegistryError::Denied("ego_scope_denied");
const APPROVAL_STALE: RegistryError = RegistryError::Conflict("ego_approval_stale");
const COUNTER: &str = "utf8-bytes-v1";

pub(crate) struct IdentityApproval {
    ticket: String,
    session: String,
    phy: OwnerId,
    deadline: Instant,
    draft: PreparedEgoIdentity,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    profile_id: String,
    principal_id: String,
    operation: String,
    body: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Context {
    session_id: String,
    query: String,
    budget: usize,
    counter: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Scope {
    Phy,
    Rel,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PinCommand {
    session_id: Option<String>,
    scope: Scope,
    owner_id: OwnerId,
    id: Option<EgoPinId>,
    revision: Option<u64>,
    text: Option<String>,
    priority: Option<EgoPinPriority>,
    query: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IdentityCommand {
    owner_id: OwnerId,
    name: Option<String>,
    text: Option<String>,
    draft: Option<EgoIdentityDraft>,
    selection_revision: Option<u64>,
    id: Option<EgoIdentityId>,
    revision: Option<u64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SlashDraft {
    session_id: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SlashApproval {
    session_id: String,
    ticket: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SummaryQuery {
    session_id: Option<String>,
    owner_id: OwnerId,
    rel_id: Option<OwnerId>,
    revision: Option<u64>,
    edit: Option<EgoSummaryEdit>,
}

pub(crate) fn execute(registry: &mut Registry, bytes: &[u8]) -> Result<Value, RegistryError> {
    let request: Request = decode(bytes).map_err(|_| INVALID)?;
    if request.profile_id != registry.profile_id()
        || request.principal_id != registry.principal_id()
    {
        return Err(DENIED);
    }
    match request.operation.as_str() {
        "status" if request.body == json!({}) => {
            Ok(json!({"enabled": registry.ego_actor().is_ok(), "phy": registry.active_phy()}))
        }
        "context" => context(registry, body(request.body)?),
        "scopes" => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Session {
                session_id: String,
            }
            let input: Session = body(request.body)?;
            if !valid_id(&input.session_id) {
                return Err(INVALID);
            }
            registry.ego_actor()?;
            Ok(
                json!({"rel": registry.source_owner(&input.session_id, true)?, "phy": registry.active_phy()}),
            )
        }
        op @ ("pins" | "pin_create" | "pin_modify" | "pin_delete") => {
            pins(registry, op, body(request.body)?)
        }
        op @ ("identities" | "identity_create" | "identity_edit" | "identity_select") => {
            identities(registry, op, body(request.body)?)
        }
        "identity_prepare" => prepare(registry, body(request.body)?),
        "identity_approve" => approve(registry, body(request.body)?),
        op @ ("summary" | "summary_edit") => summaries(registry, op, body(request.body)?),
        _ => Err(INVALID),
    }
}

fn body<T: DeserializeOwned>(value: Value) -> Result<T, RegistryError> {
    serde_json::from_value(value).map_err(|_| INVALID)
}

fn response<T: Serialize>(key: &str, value: T) -> Result<Value, RegistryError> {
    let value = serde_json::to_value(value).map_err(|_| INVALID)?;
    let mut fields = serde_json::Map::new();
    fields.insert(key.to_owned(), value);
    Ok(Value::Object(fields))
}

fn context(registry: &Registry, input: Context) -> Result<Value, RegistryError> {
    if !valid_id(&input.session_id)
        || input.query.len() > 4096
        || input.budget > 32_768
        || input.counter != COUNTER
    {
        return Err(INVALID);
    }
    let actor = registry.ego_actor()?;
    let rel = registry.source_owner(&input.session_id, true)?;
    let result = actor
        .ego_context(
            Some(rel),
            registry.active_phy(),
            &input.query,
            None,
            input.budget,
            str::len,
        )
        .map_err(owner_error)?;
    serde_json::to_value(result).map_err(|_| INVALID)
}

fn pins(registry: &Registry, op: &str, input: PinCommand) -> Result<Value, RegistryError> {
    let actor = registry.ego_actor()?;
    let scope = match input.scope {
        Scope::Phy if input.owner_id == registry.active_phy() => EgoScope::Phy(input.owner_id),
        Scope::Rel => {
            require_rel_scope(registry, input.owner_id, input.session_id.as_deref())?;
            EgoScope::Rel(input.owner_id)
        }
        Scope::Phy => return Err(DENIED),
    };
    if let Some(session) = input.session_id.as_deref() {
        if !valid_id(session) {
            return Err(INVALID);
        }
        registry.source_owner(session, true)?;
    }
    match op {
        "pins" => {
            let query = input.query.as_deref().unwrap_or_default();
            if query.len() > 4096 {
                return Err(INVALID);
            }
            let query = query.to_lowercase();
            let pins = actor
                .ego_pins(scope)
                .map_err(owner_error)?
                .into_iter()
                .filter(|pin| {
                    input.id.is_none_or(|id| id == pin.id)
                        && (query.is_empty() || pin.text.to_lowercase().contains(&query))
                })
                .take(50)
                .collect::<Vec<_>>();
            response("pins", pins)
        }
        "pin_create" => response(
            "pin",
            actor
                .pin_anchor(scope, input.text.ok_or(INVALID)?, input.priority)
                .map_err(owner_error)?,
        ),
        "pin_modify" => response(
            "pin",
            actor
                .modify_anchor(
                    scope,
                    input.id.ok_or(INVALID)?,
                    input.revision.ok_or(INVALID)?,
                    EgoPinPatch {
                        text: input.text,
                        priority: input.priority,
                    },
                )
                .map_err(owner_error)?,
        ),
        "pin_delete" => {
            actor
                .delete_anchor(
                    scope,
                    input.id.ok_or(INVALID)?,
                    input.revision.ok_or(INVALID)?,
                )
                .map_err(owner_error)?;
            Ok(json!({"deleted": true}))
        }
        _ => Err(INVALID),
    }
}

fn identities(
    registry: &Registry,
    op: &str,
    input: IdentityCommand,
) -> Result<Value, RegistryError> {
    let actor = registry.ego_actor()?;
    let phy = registry.active_phy();
    if input.owner_id != phy {
        return Err(DENIED);
    }
    match op {
        "identities" => {
            let (selection, identities) = actor.ego_identities(phy).map_err(owner_error)?;
            Ok(json!({"selection": selection, "identities": identities}))
        }
        "identity_create" => response(
            "identity",
            actor
                .create_ego_identity(phy, input.name.ok_or(INVALID)?, input.text.ok_or(INVALID)?)
                .map_err(owner_error)?,
        ),
        "identity_edit" => response(
            "identity",
            actor
                .edit_ego_identity(phy, input.draft.ok_or(INVALID)?)
                .map_err(owner_error)?,
        ),
        "identity_select" => {
            if input.id.is_some() != input.revision.is_some() {
                return Err(INVALID);
            }
            response(
                "selection",
                actor
                    .select_ego_identity(
                        phy,
                        input.selection_revision.ok_or(INVALID)?,
                        input.id.zip(input.revision),
                    )
                    .map_err(owner_error)?,
            )
        }
        _ => Err(INVALID),
    }
}

fn prepare(registry: &mut Registry, input: SlashDraft) -> Result<Value, RegistryError> {
    if !valid_id(&input.session_id) {
        return Err(INVALID);
    }
    registry.source_owner(&input.session_id, true)?;
    let phy = registry.active_phy();
    let actor = registry.ego_actor()?;
    let (selected, values) = actor.ego_identities(phy).map_err(owner_error)?;
    let selected = selected
        .and_then(|selection| selection.id)
        .and_then(|id| values.into_iter().find(|value| value.id == id))
        .ok_or(RegistryError::Conflict("ego_identity_not_selected"))?;
    let draft = actor
        .prepare_ego_identity(
            phy,
            EgoIdentityDraft {
                id: selected.id,
                revision: selected.revision,
                name: selected.name,
                text: input.text,
            },
        )
        .map_err(owner_error)?;
    let mut entropy = [0_u8; 16];
    getrandom::fill(&mut entropy)
        .map_err(|_| RegistryError::Unavailable("ego_approval_unavailable"))?;
    let ticket = entropy
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let result = json!({"ticket": ticket, "draft": draft.draft()});
    registry.ego_approval = Some(IdentityApproval {
        ticket,
        session: input.session_id,
        phy,
        deadline: Instant::now() + Duration::from_secs(300),
        draft,
    });
    Ok(result)
}

fn approve(registry: &mut Registry, input: SlashApproval) -> Result<Value, RegistryError> {
    if !valid_id(&input.session_id) || !valid_id(&input.ticket) {
        return Err(INVALID);
    }
    registry.source_owner(&input.session_id, true)?;
    let phy = registry.active_phy();
    registry.ego_actor()?;
    if !registry.ego_approval.as_ref().is_some_and(|approval| {
        approval.ticket == input.ticket
            && approval.session == input.session_id
            && approval.phy == phy
            && Instant::now() < approval.deadline
    }) {
        return Err(APPROVAL_STALE);
    }
    let approval = registry.ego_approval.take().ok_or(APPROVAL_STALE)?;
    response(
        "identity",
        registry
            .ego_actor()?
            .approve_ego_identity(phy, approval.draft)
            .map_err(owner_error)?,
    )
}

fn require_rel_scope(
    registry: &Registry,
    rel: OwnerId,
    session: Option<&str>,
) -> Result<(), RegistryError> {
    let (_, kind, _) = registry.dashboard_scope(
        registry.profile_id(),
        &registry.active_phy().to_string(),
        &rel.to_string(),
        session,
    )?;
    if kind != reliquary_memory::OwnerKind::Rel {
        return Err(DENIED);
    }
    Ok(())
}

fn summaries(registry: &Registry, op: &str, input: SummaryQuery) -> Result<Value, RegistryError> {
    let phy = registry.active_phy();
    if input.owner_id != phy {
        return Err(DENIED);
    }
    if let Some(rel) = input.rel_id {
        require_rel_scope(registry, rel, input.session_id.as_deref())?;
    }
    let actor = registry.ego_actor()?;
    match (op, input.rel_id) {
        ("summary", Some(rel)) => response(
            "summary",
            actor
                .inspect_ego_rel_summary(phy, rel, input.revision)
                .map_err(owner_error)?,
        ),
        ("summary", None) => response(
            "summary",
            actor
                .inspect_ego_phy_summary(phy, input.revision)
                .map_err(owner_error)?,
        ),
        ("summary_edit", Some(rel)) => response(
            "revision",
            actor
                .edit_ego_rel_summary(
                    phy,
                    rel,
                    input.revision.ok_or(INVALID)?,
                    input.edit.ok_or(INVALID)?,
                )
                .map_err(owner_error)?,
        ),
        _ => Err(INVALID),
    }
}
