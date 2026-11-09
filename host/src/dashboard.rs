//! Dashboard-v1 reads over the admitted profile's mounted Root owners.
use crate::{
    registry::{DashboardOwnerBinding, Registry, RegistryError},
    retrieval::{RetrievalService, no_dashboard_recall},
    runtime::RuntimeRegistry,
    service_http::{HttpError, HttpResponse, INVALID, MAX_WIRE_BYTES},
    service_protocol::{decode, valid_id},
    source_ingest::{DashboardSourceStatus, SourceService},
};
use reliquary_memory::{InspectionCursor, InspectionCut, Instance, ProductError, ProductErrorKind};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::Mutex;

#[path = "dashboard_graph.rs"]
mod graph;
#[path = "dashboard_intent.rs"]
mod intent;
#[path = "dashboard_memory.rs"]
mod memory;
#[path = "dashboard_mutation.rs"]
mod mutation;
#[path = "dashboard_retirement.rs"]
mod retirement;

pub(crate) struct DashboardPage {
    pub(crate) result: Value,
    pub(crate) cut: InspectionCut,
    pub(crate) next: Option<InspectionCursor>,
}

pub(crate) struct DashboardError {
    status: &'static str,
    code: &'static str,
}

impl DashboardError {
    pub(crate) fn invalid(code: &'static str) -> Self {
        Self {
            status: "invalid",
            code,
        }
    }
    pub(crate) fn unavailable(code: &'static str) -> Self {
        Self {
            status: "unavailable",
            code,
        }
    }
    pub(crate) fn denied(code: &'static str) -> Self {
        Self {
            status: "denied",
            code,
        }
    }
    pub(crate) fn unsupported(code: &'static str) -> Self {
        Self {
            status: "unsupported",
            code,
        }
    }
    pub(crate) fn stale(code: &'static str) -> Self {
        Self {
            status: "stale_cursor",
            code,
        }
    }
    pub(crate) fn conflict(code: &'static str) -> Self {
        Self {
            status: "conflict",
            code,
        }
    }

    pub(crate) fn product(error: ProductError) -> Self {
        match error.kind() {
            ProductErrorKind::Unauthorized | ProductErrorKind::Revoked => {
                Self::denied("owner_denied")
            }
            ProductErrorKind::Stale => Self::stale("owner_cut_changed"),
            ProductErrorKind::InvalidInput => Self::invalid("invalid_owner_query"),
            ProductErrorKind::Conflict => Self::conflict("owner_conflict"),
            ProductErrorKind::Unsupported => Self::unsupported("owner_operation_unavailable"),
            _ => Self::unavailable("owner_unavailable"),
        }
    }

    fn registry(error: RegistryError) -> Self {
        match error {
            RegistryError::Invalid(_) => Self::invalid("invalid_owner_scope"),
            RegistryError::Denied(_) => Self::denied("owner_denied"),
            RegistryError::Conflict(_) => Self::conflict("owner_conflict"),
            RegistryError::Unavailable(_) => Self::unavailable("owner_unavailable"),
        }
    }
}

pub(crate) fn cut_id(cut: &InspectionCut) -> String {
    // The cut contains only fixed-width scalar/array fields.
    let encoded = serde_json::to_vec(cut).expect("serializable inspection cut");
    crate::service_http::hex(&Sha256::digest(encoded))
}

pub(crate) fn generation_id(cut: &InspectionCut) -> String {
    u128::from_le_bytes(cut.generation[..16].try_into().expect("fixed generation")).to_string()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PrivateRequest {
    request: DashboardRequest,
    cursor: Option<InspectionCursor>,
    same_origin: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DashboardRequest {
    protocol_version: u8,
    request_id: String,
    operation: String,
    profile_id: String,
    principal_id: String,
    session_id: Option<String>,
    owner_id: String,
    generation: String,
    cut: String,
    expected_revision: Option<String>,
    idempotency_key: Option<String>,
    arguments: Value,
}

pub(crate) fn read(
    instance: &Instance,
    registry: &Mutex<Registry>,
    retrieval: &Mutex<RetrievalService>,
    sources: &Mutex<SourceService>,
    runtimes: &Mutex<RuntimeRegistry>,
    bytes: &[u8],
) -> Result<HttpResponse, HttpError> {
    let envelope: PrivateRequest = decode(bytes).map_err(|_| INVALID)?;
    let request = &envelope.request;
    if request.protocol_version != 1
        || !valid_id(&request.request_id)
        || !valid_id(&request.operation)
        || !request.arguments.is_object()
    {
        return Err(INVALID);
    }
    if request.idempotency_key.is_some() {
        let body = match write(instance, registry, request, envelope.same_origin) {
            Ok(body) => body,
            Err(error) => error_response(request, error),
        };
        return Ok(HttpResponse::ok(body));
    }
    let result = dispatch(
        instance,
        registry,
        retrieval,
        sources,
        runtimes,
        request,
        envelope.cursor.as_ref(),
    );
    let body = match result {
        Ok((binding, page)) => {
            let response = json!({"response": {"protocol_version": 1, "request_id": request.request_id,
                "operation": request.operation, "status": "ok", "binding": binding, "result": page.result},
                "cursor": page.next});
            if serde_json::to_vec(&response).map_err(|_| INVALID)?.len() > MAX_WIRE_BYTES {
                error_response(
                    request,
                    DashboardError::unavailable("dashboard_response_too_large"),
                )
            } else {
                response
            }
        }
        Err(error) => error_response(request, error),
    };
    Ok(HttpResponse::ok(body))
}

fn dispatch(
    instance: &Instance,
    registry: &Mutex<Registry>,
    retrieval: &Mutex<RetrievalService>,
    sources: &Mutex<SourceService>,
    runtimes: &Mutex<RuntimeRegistry>,
    request: &DashboardRequest,
    cursor: Option<&InspectionCursor>,
) -> Result<(DashboardOwnerBinding, DashboardPage), DashboardError> {
    let (owner, kind, label) = registry
        .lock()
        .map_err(|_| DashboardError::unavailable("owner_unavailable"))?
        .dashboard_scope(
            &request.profile_id,
            &request.principal_id,
            &request.owner_id,
            request.session_id.as_deref(),
        )
        .map_err(DashboardError::registry)?;
    if request.expected_revision.is_some() || request.idempotency_key.is_some() {
        return Err(DashboardError::unsupported("operation_unavailable"));
    }
    // Check the private request binding before reading payloads. Repeat the check at the
    // projection cut so a concurrent owner write cannot slip into an earlier UI page.
    let current = crate::registry::owner_binding(instance, owner, kind, &label)
        .map_err(DashboardError::registry)?;
    if (request.generation.as_str(), request.cut.as_str())
        != (current.generation.as_str(), current.cut.as_str())
    {
        return Err(DashboardError::stale("owner_cut_changed"));
    }
    let page = match request.operation.as_str() {
        "ui.memory_list" | "ui.memory_detail" | "ui.memory_history" | "ui.provenance" => {
            memory::read(
                instance,
                owner,
                kind,
                &request.operation,
                &request.arguments,
                cursor,
                &mut |source_owner, turn| {
                    // Use the same lock order as selected return. Busy or
                    // unverifiable copied evidence must not disclose IDs.
                    let registry = registry.try_lock().map_err(|_| "missing")?;
                    let sources = sources.try_lock().map_err(|_| "missing")?;
                    let mut runtimes = runtimes.try_lock().map_err(|_| "missing")?;
                    sources.dashboard_provenance(&registry, &mut runtimes, source_owner, turn)
                },
            )
        }
        "ui.graph_page" | "ui.community_list" | "ui.community_members" => graph::read(
            instance,
            owner,
            kind,
            &request.operation,
            &request.arguments,
            cursor,
        ),
        "ui.operational_status" if kind == reliquary_memory::OwnerKind::Rel => {
            let session = request.session_id.as_deref();
            let (source, recall) = if let Some(session) = session {
                // Match the existing provider delivery lock order. A busy worker
                // yields typed unavailability without delaying provider delivery.
                let retrieval = retrieval
                    .try_lock()
                    .map_err(|_| DashboardError::unavailable("recall_busy"))?;
                let sources = sources
                    .try_lock()
                    .map_err(|_| DashboardError::unavailable("source_busy"))?;
                let mut runtimes = runtimes
                    .try_lock()
                    .map_err(|_| DashboardError::unavailable("runtime_busy"))?;
                let source = sources
                    .dashboard_status(session, &mut runtimes)
                    .map_err(|_| DashboardError::unavailable("source_status_unavailable"))?;
                let recall = if matches!(source.state, "stale" | "tombstoned") {
                    no_dashboard_recall()
                } else {
                    retrieval.dashboard_recall(session)
                };
                (source, recall)
            } else {
                (
                    DashboardSourceStatus {
                        state: "none",
                        cursor: None,
                        receipt: None,
                        import_id: None,
                    },
                    no_dashboard_recall(),
                )
            };
            let progress = if session.is_none() || source.import_id.is_some() {
                instance
                    .processing_status(owner, source.import_id.as_deref())
                    .map_err(DashboardError::product)?
            } else {
                Default::default()
            };
            let cut = crate::registry::inspect_dashboard_cut(instance, owner, kind)
                .map_err(DashboardError::registry)?;
            let worker = if progress.failed > 0 {
                "failed"
            } else if progress.held > 0 {
                "held"
            } else if progress.processing > 0 {
                "running"
            } else if progress.pending > 0 {
                "pending"
            } else {
                "complete"
            };
            Ok(DashboardPage {
                cut,
                next: None,
                result: json!({
                    "session_id": session, "source_state": source.state, "accepted_source_cursor": source.cursor,
                    "last_completed_receipt": source.receipt, "pending_count": progress.pending.to_string(),
                    "held_count": progress.held.to_string(), "error_count": progress.failed.to_string(),
                    "worker_state": worker, "latest_recall": recall,
                }),
            })
        }
        _ => Err(DashboardError::unsupported("operation_unavailable")),
    }?;
    if (generation_id(&page.cut), cut_id(&page.cut))
        != (current.generation.clone(), current.cut.clone())
    {
        return Err(DashboardError::stale("owner_cut_changed"));
    }
    Ok((current, page))
}

fn write(
    instance: &Instance,
    registry: &Mutex<Registry>,
    request: &DashboardRequest,
    same_origin: bool,
) -> Result<Value, DashboardError> {
    use reliquary_memory::OwnerKind;
    let registry = registry
        .lock()
        .map_err(|_| DashboardError::unavailable("owner_unavailable"))?;
    let (owner, kind, label) = registry
        .dashboard_scope(
            &request.profile_id,
            &request.principal_id,
            &request.owner_id,
            request.session_id.as_deref(),
        )
        .map_err(DashboardError::registry)?;
    if !same_origin || kind != OwnerKind::Rel {
        return Err(DashboardError::denied("mutation_denied"));
    }
    if !matches!(
        request.operation.as_str(),
        "ui.memory_create"
            | "ui.memory_edit"
            | "ui.memory_retire"
            | "ui.relation_change"
            | "ui.community_rename"
    ) {
        return Err(DashboardError::unsupported("operation_unavailable"));
    }
    let key = request
        .idempotency_key
        .as_deref()
        .filter(|key| valid_id(key))
        .ok_or_else(|| DashboardError::invalid("invalid_idempotency_key"))?;
    if request.arguments.get("created_at_ns").is_some()
        || request.arguments.get("expected_body_id").is_some()
        || request.arguments.get("retirement").is_some()
    {
        return Err(DashboardError::invalid("invalid_arguments"));
    }
    let cut = crate::registry::inspect_dashboard_cut(instance, owner, kind)
        .map_err(DashboardError::registry)?;
    let actor = registry.dashboard_actor();
    let intent = intent::prepare(
        registry.dashboard_intents(),
        actor,
        owner,
        request,
        key,
        cut,
    )?;
    let mut args = request.arguments.clone();
    args["created_at_ns"] = json!(intent.created_at_ns);
    args["expected_body_id"] = json!(intent.expected_body_id);
    args["retirement"] = json!(intent.retirement);
    let receipt = mutation::write(
        actor,
        owner,
        &request.operation,
        &args,
        intent.cut,
        request.expected_revision.as_deref(),
        &request.request_id,
        key,
        &request.principal_id,
    )
    .map_err(|error| {
        if error.status == "stale_cursor" {
            DashboardError::conflict("owner_cut_changed")
        } else {
            error
        }
    })?;
    let binding = crate::registry::dashboard_binding_at_cut(owner, kind, &label, &receipt.cut);
    Ok(
        json!({"response": {"protocol_version": 1, "request_id": request.request_id,
        "operation": request.operation, "status": "ok", "binding": binding, "result": {
            "receipt_id": receipt.receipt_id, "request_id": request.request_id, "idempotency_key": key,
            "changed": receipt.changed, "committed": receipt.committed,
        }}, "cursor": null}),
    )
}

fn error_response(request: &DashboardRequest, error: DashboardError) -> Value {
    json!({"response": {"protocol_version": 1, "request_id": request.request_id,
        "operation": request.operation, "status": error.status, "binding": null,
        "result": {"code": error.code, "retryable": false}}, "cursor": null})
}
