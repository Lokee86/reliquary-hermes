//! Durable preparation of user-origin request inputs before entering Root.
use super::{DashboardError, DashboardRequest, cut_id, generation_id};
use crate::registry::registry_store as store;
use reliquary_memory::{InspectionCut, Instance, OwnerId, OwnerKind};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct MutationIntent {
    pub(crate) cut: InspectionCut,
    pub(crate) created_at_ns: String,
    pub(crate) expected_body_id: Option<String>,
    #[serde(default)]
    pub(crate) retirement: Option<RetirementEvidence>,
    fingerprint: [u8; 32],
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RetirementEvidence {
    pub(crate) body_id: String,
    pub(crate) successor_id: [u8; 32],
    pub(crate) successor_revision: u64,
    pub(crate) successor_body_id: String,
}

pub(super) fn prepare(
    directory: &Path,
    instance: &Instance,
    owner: OwnerId,
    request: &DashboardRequest,
    key: &str,
    current: InspectionCut,
) -> Result<MutationIntent, DashboardError> {
    let key_fields = (&request.principal_id, owner, &request.operation, key);
    let key_digest = digest(&key_fields)?;
    let fingerprint = digest(&(
        &key_fields,
        &request.session_id,
        &request.generation,
        &request.cut,
        &request.expected_revision,
        &request.arguments,
    ))?;
    fs::create_dir_all(directory)
        .map_err(|_| DashboardError::unavailable("mutation_state_unavailable"))?;
    if !directory
        .symlink_metadata()
        .is_ok_and(|metadata| metadata.is_dir())
    {
        return Err(DashboardError::unavailable("mutation_state_unavailable"));
    }
    let directory = fs::canonicalize(directory)
        .map_err(|_| DashboardError::unavailable("mutation_state_unavailable"))?;
    let path = directory.join(format!("{}.json", crate::service_http::hex(&key_digest)));
    if let Some(intent) =
        store::read::<MutationIntent>(&path, 4096).map_err(DashboardError::registry)?
    {
        if intent.fingerprint != fingerprint {
            return Err(DashboardError::conflict("idempotency_key_reused"));
        }
        if generation_id(&current) != request.generation
            || intent.cut.generation != current.generation
            || intent.cut.owner_id != owner.as_bytes()
            || cut_id(&intent.cut) != request.cut
        {
            return Err(DashboardError::conflict("owner_cut_changed"));
        }
        if request.operation == "ui.memory_retire" && current == intent.cut {
            let id = super::memory::required_id(&request.arguments, "memory_id")?;
            let accepted_successor =
                super::retirement::successor(instance, owner, OwnerKind::Rel, id, current, true)?;
            if intent
                .retirement
                .as_ref()
                .is_none_or(|evidence| evidence.successor_id != accepted_successor.0)
            {
                return Err(DashboardError::conflict("supersession_successor_changed"));
            }
        }
        // A prior publish may have returned an error after the atomic rename.
        store::sync_parent(&path).map_err(DashboardError::registry)?;
        return Ok(intent);
    }
    if generation_id(&current) != request.generation || cut_id(&current) != request.cut {
        return Err(DashboardError::conflict("owner_cut_changed"));
    }
    let mut retirement = None;
    let expected_body_id = if matches!(
        request.operation.as_str(),
        "ui.memory_edit" | "ui.memory_retire"
    ) {
        let id = super::memory::required_id(&request.arguments, "memory_id")?;
        let manager = instance
            .workspace_management(owner)
            .map_err(DashboardError::product)?;
        let memory = manager.memory(id).map_err(DashboardError::product)?;
        if request.expected_revision.as_deref() != Some(memory.revision.to_string().as_str()) {
            return Err(DashboardError::conflict("memory_revision_changed"));
        }
        if request.operation == "ui.memory_retire" {
            if !memory.archived || !memory.payload_available {
                return Err(DashboardError::conflict("memory_not_retirable"));
            }
            let successor =
                super::retirement::successor(instance, owner, OwnerKind::Rel, id, current, true)?;
            let accepted = manager.memory(successor).map_err(DashboardError::product)?;
            if accepted.archived || !accepted.payload_available {
                return Err(DashboardError::conflict(
                    "supersession_successor_unavailable",
                ));
            }
            if crate::registry::inspect_dashboard_cut(instance, owner, OwnerKind::Rel)
                .map_err(DashboardError::registry)?
                != current
            {
                return Err(DashboardError::conflict("owner_cut_changed"));
            }
            retirement = Some(RetirementEvidence {
                body_id: memory.body_id.clone(),
                successor_id: successor.0,
                successor_revision: accepted.revision,
                successor_body_id: accepted.body_id,
            });
        }
        Some(memory.body_id)
    } else {
        None
    };
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| DashboardError::unavailable("mutation_clock_unavailable"))?
        .as_millis();
    let timestamp = i64::try_from(now_ms)
        .ok()
        .and_then(|ms| ms.checked_mul(1_000_000))
        .ok_or_else(|| DashboardError::unavailable("mutation_clock_unavailable"))?;
    let intent = MutationIntent {
        cut: current,
        created_at_ns: timestamp.to_string(),
        expected_body_id,
        retirement,
        fingerprint,
    };
    store::publish(&path, &intent).map_err(DashboardError::registry)?;
    Ok(intent)
}

fn digest(value: &impl Serialize) -> Result<[u8; 32], DashboardError> {
    serde_json::to_vec(value)
        .map(|data| Sha256::digest(data).into())
        .map_err(|_| DashboardError::invalid("invalid_mutation"))
}
