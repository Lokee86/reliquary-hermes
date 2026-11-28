//! One profile-scoped local service and its owner registry.
use crate::{
    embedding_binding::EmbeddingBindingStore,
    graph_render_host::GraphRenderHost,
    hosted_inference::{Broker, IDENTITY, WORKER_ERROR},
    registry::{
        OwnerConfig, Registry, RegistryError, SwitchChanges, SwitchReview, committed_switch_status,
    },
    retrieval::RetrievalService,
    runtime::{HEARTBEAT_SECONDS, ReconciliationScope, RuntimeRegistry},
    service_http::{
        ATTACH, DASHBOARD_READ, DASHBOARD_TOPOLOGY, EGO, FORBIDDEN, GRAPH_RENDER_EDGE_CHUNK,
        GRAPH_RENDER_ELIGIBLE, GRAPH_RENDER_INSPECT, GRAPH_RENDER_LOCATE,
        GRAPH_RENDER_NEIGHBORHOOD, GRAPH_RENDER_NODE_CHUNK, GRAPH_RENDER_PREPARE,
        GRAPH_RENDER_RESOLVE, HttpError, HttpRequest, HttpResponse, INVALID, MAX_WIRE_BYTES,
        RETRIEVAL_PREPARE, RETRIEVAL_TOOL, RUNTIME_ATTACH, RUNTIME_DETACH, RUNTIME_HEARTBEAT,
        RUNTIME_SCOPE, SETUP_APPLY, SETUP_REVIEW, SETUP_STATUS, SOURCE, SOURCE_STATUS,
        TransportKey, UNAVAILABLE, hex, read_request, write_response,
    },
    service_protocol::{
        AttachRequest, Discovery, HERMES_REVISION, Operation, PROTOCOL_VERSION, ProviderRequest,
        RuntimeAttachRequest, RuntimeDetachRequest, RuntimeLeaseRequest, RuntimeScopeRequest,
        decode,
    },
    source_ingest::{SourceBinding, SourceService},
    source_wire::{SourceAction, SourceRequest},
};
use reliquary_memory::{Instance, OwnerId};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    net::{Ipv4Addr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, MutexGuard, RwLock, TryLockError,
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc::{TrySendError, sync_channel},
    },
    thread,
    time::{Duration, Instant},
};

const WORKERS: usize = 4;
const QUEUE_CAPACITY: usize = 8;
const BOOTSTRAP_LIMIT: usize = 4096;
// Hermes v0.23.0 stops waiting for automatic prefetch after eight seconds.
// An explicit tool can wait for both configured model calls (embedding and decision).
const PREFETCH_BUDGET: Duration = Duration::from_millis(6500);
const RETRIEVAL_TOOL_BUDGET: Duration = Duration::from_secs(65);
const RETRIEVAL_BUSY: HttpError = HttpError::new(503, "retrieval_busy", true);
const INFERENCE_BUSY: HttpError = HttpError::new(503, "inference_backpressure", true);
const OWNER_SWITCH_BUSY: HttpError = HttpError::new(409, "owner_switch_busy", true);

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Bootstrap {
    token: String,
}

struct Service {
    expected_host: String,
    discovery: Discovery,
    principal_id: String,
    // Compatibility evidence for the first-run settings handshake only.
    bootstrap_fingerprint: String,
    key: TransportKey,
    sources: Mutex<SourceService>,
    retrieval: Mutex<RetrievalService>,
    graph_render: Mutex<GraphRenderHost>,
    retrieval_waiter: Mutex<()>,
    retrieval_busy: AtomicBool,
    deferred_invalidations: Mutex<BTreeSet<String>>,
    inference: Broker,
    runtime_binding: Mutex<()>,
    embedding_bindings: EmbeddingBindingStore,
    blocking_workers: AtomicUsize,
    runtimes: Mutex<RuntimeRegistry>,
    closing: AtomicBool,
    inflight: AtomicUsize,
    owner_requests: RwLock<()>,
    // Drop the source service (and join its jobs) before releasing owner leases.
    registry: Mutex<Registry>,
}

impl Service {
    fn ensure_embedding_owner(&self, instance: &Instance, owner: OwnerId) -> Result<(), HttpError> {
        let identity = self
            .inference
            .embedding_binding()
            .map_err(|code| HttpError::new(503, code, true))?;
        self.embedding_bindings
            .ensure_owner(owner, &identity, || {
                instance.has_active_vectors(owner).map_err(|_| ())
            })
            .map_err(|code| HttpError::new(503, code, true))
    }

    fn restore_retrieval(
        &self,
        instance: &Instance,
        work: RetrievalService,
    ) -> Result<(), HttpError> {
        let mut retrieval = self.retrieval.lock().map_err(|_| UNAVAILABLE)?;
        retrieval.restore_work(work);
        let invalidations = {
            let mut pending = self
                .deferred_invalidations
                .lock()
                .map_err(|_| UNAVAILABLE)?;
            std::mem::take(&mut *pending)
        };
        for session in invalidations {
            retrieval.invalidate_session(&session, instance);
        }
        Ok(())
    }

    fn invalidate_retrieval(&self, instance: &Instance, session: &str) {
        if self.retrieval_busy.load(Ordering::Acquire) {
            if let Ok(mut pending) = self.deferred_invalidations.lock() {
                pending.insert(session.to_owned());
            }
            return;
        }
        if let Ok(mut retrieval) = self.retrieval.try_lock() {
            if self.retrieval_busy.load(Ordering::Acquire) {
                if let Ok(mut pending) = self.deferred_invalidations.lock() {
                    pending.insert(session.to_owned());
                }
            } else {
                retrieval.invalidate_session(session, instance);
            }
        }
    }

    fn connection(&self, mut socket: TcpStream, accepted_at: Instant) {
        match read_request(&mut socket, accepted_at, &self.expected_host, &self.key) {
            Ok(request) => {
                let control = reserved_worker_path(request.path);
                let admitted = admit_worker_request(request.path, &self.blocking_workers);
                let signature = Some((&self.key, &request.nonce));
                if !admitted {
                    let _ = write_response(&mut socket, INFERENCE_BUSY.into_response(), signature);
                    return;
                }
                let result = self.with_owner_admission(request.path, || {
                    let response = self
                        .dispatch(&request, accepted_at)
                        .unwrap_or_else(HttpError::into_response);
                    let _ = write_response(&mut socket, response, signature);
                });
                if !control {
                    self.blocking_workers.fetch_sub(1, Ordering::AcqRel);
                }
                if let Err(error) = result {
                    let _ = write_response(&mut socket, error.into_response(), signature);
                }
            }
            Err(error) => {
                let _ = write_response(&mut socket, error.into_response(), None);
            }
        }
    }

    // Finish owner responses before publishing a different grant set. Model
    // callbacks and heartbeats remain available while owner work drains.
    fn with_owner_admission(&self, path: &str, run: impl FnOnce()) -> Result<(), HttpError> {
        if path == SETUP_APPLY {
            let _permit = self.owner_requests.try_write().map_err(owner_gate_error)?;
            run();
        } else if path == RUNTIME_HEARTBEAT
            || (path.starts_with("/v1/inference/") && path != IDENTITY)
        {
            run();
        } else {
            let _permit = self.owner_requests.try_read().map_err(owner_gate_error)?;
            run();
        }
        Ok(())
    }

    fn dispatch(
        &self,
        request: &HttpRequest,
        accepted_at: Instant,
    ) -> Result<HttpResponse, HttpError> {
        if self.closing.load(Ordering::Acquire) {
            return Err(UNAVAILABLE);
        }
        if request.path.starts_with("/v1/inference/") {
            if request.path == IDENTITY {
                let (response, ()) = bind_identity_runtime(
                    &self.runtime_binding,
                    &self.inference,
                    &request.body,
                    &self.discovery.profile_id,
                    &self.discovery.instance_id,
                    &self.discovery.lease_id,
                    |runtime, epoch| {
                        let mut registry = self.registry.lock().map_err(|_| UNAVAILABLE)?;
                        registry
                            .set_ego_runtime(Some((epoch, Arc::clone(&runtime))))
                            .map_err(attach_error)?;
                        registry
                            .set_perception_runtime(
                                (self.inference.native_epoch() == Some(epoch))
                                    .then(|| (epoch, Arc::clone(&runtime))),
                            )
                            .map_err(attach_error)?;
                        drop(registry);
                        self.sources
                            .lock()
                            .map_err(|_| UNAVAILABLE)?
                            .bind_runtime(Arc::clone(&runtime));
                        self.retrieval
                            .lock()
                            .map_err(|_| UNAVAILABLE)?
                            .bind_runtime(runtime);
                        let registry = self.registry.lock().map_err(|_| UNAVAILABLE)?;
                        let mut sources = self.sources.lock().map_err(|_| UNAVAILABLE)?;
                        let mut runtimes = self.runtimes.lock().map_err(|_| UNAVAILABLE)?;
                        let instance = registry.instance().map_err(attach_error)?;
                        sources.resume_all(&instance, &registry, &mut runtimes, |owner| {
                            self.ensure_embedding_owner(&instance, owner).is_ok()
                        })?;
                        Ok(())
                    },
                )?;
                return Ok(response);
            }
            let _runtime_binding = if request.path == WORKER_ERROR {
                Some(self.runtime_binding.lock().map_err(|_| UNAVAILABLE)?)
            } else {
                None
            };
            let response = self.inference.handle(
                &request.path,
                &request.body,
                &self.discovery.profile_id,
                &self.discovery.instance_id,
                &self.discovery.lease_id,
            )?;
            if request.path == WORKER_ERROR {
                let mut registry = self.registry.lock().map_err(|_| UNAVAILABLE)?;
                registry.set_ego_runtime(None).map_err(attach_error)?;
                registry
                    .set_perception_runtime(None)
                    .map_err(attach_error)?;
            }
            return Ok(response);
        }
        match request.path {
            SETUP_STATUS | SETUP_REVIEW | SETUP_APPLY => {
                return self.owner_setup(request.path, &request.body);
            }
            RUNTIME_ATTACH => return self.runtime_attach(&request.body),
            RUNTIME_HEARTBEAT => return self.runtime_heartbeat(&request.body),
            RUNTIME_DETACH => return self.runtime_detach(&request.body),
            RUNTIME_SCOPE => return self.runtime_scope(&request.body),
            _ => {}
        }
        let current = self
            .registry
            .lock()
            .map_err(|_| UNAVAILABLE)?
            .instance()
            .map_err(attach_error)?;
        let instance = &current;
        match request.path {
            ATTACH => self.attach(instance, &request.body),
            EGO => {
                let mut registry = self.registry.lock().map_err(|_| UNAVAILABLE)?;
                crate::ego::execute(&mut registry, &request.body)
                    .map(HttpResponse::ok)
                    .map_err(attach_error)
            }
            SOURCE => self.source(instance, &request.body),
            SOURCE_STATUS => self.source_status(instance, &request.body),
            DASHBOARD_READ => crate::dashboard::read(
                instance,
                &self.registry,
                &self.retrieval,
                &self.sources,
                &self.runtimes,
                &request.body,
            ),
            DASHBOARD_TOPOLOGY => self.dashboard_topology(instance, &request.body),
            path @ (GRAPH_RENDER_PREPARE
            | GRAPH_RENDER_NODE_CHUNK
            | GRAPH_RENDER_EDGE_CHUNK
            | GRAPH_RENDER_RESOLVE
            | GRAPH_RENDER_INSPECT
            | GRAPH_RENDER_NEIGHBORHOOD
            | GRAPH_RENDER_LOCATE
            | GRAPH_RENDER_ELIGIBLE) => self.graph_render(instance, path, &request.body),
            RETRIEVAL_PREPARE => self.prepare_retrieval(instance, &request.body),
            RETRIEVAL_TOOL => self.request(instance, &request.body, accepted_at, true),
            _ => self.request(instance, &request.body, accepted_at, false),
        }
    }

    fn owner_setup(&self, path: &str, bytes: &[u8]) -> Result<HttpResponse, HttpError> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct SetupRequest<T> {
            profile_id: String,
            principal_id: String,
            body: T,
        }
        let request: SetupRequest<serde_json::Value> = decode(bytes).map_err(|_| INVALID)?;
        if request.profile_id != self.discovery.profile_id
            || request.principal_id != self.principal_id
        {
            return Err(FORBIDDEN);
        }
        let mut registry = self.registry.lock().map_err(|_| UNAVAILABLE)?;
        match path {
            SETUP_STATUS => {
                if request.body != json!({}) {
                    return Err(INVALID);
                }
                Ok(HttpResponse::ok(json!(
                    registry.switch_status().map_err(attach_error)?
                )))
            }
            SETUP_REVIEW => {
                let changes: SwitchChanges<PathBuf> =
                    serde_json::from_value(request.body).map_err(|_| INVALID)?;
                Ok(HttpResponse::ok(json!(
                    registry.review_switch(changes).map_err(attach_error)?
                )))
            }
            SETUP_APPLY => {
                let review: SwitchReview =
                    serde_json::from_value(request.body).map_err(|_| INVALID)?;
                if self
                    .sources
                    .lock()
                    .map_err(|_| UNAVAILABLE)?
                    .has_active_jobs()
                {
                    return Err(OWNER_SWITCH_BUSY);
                }
                let mut recall = self.retrieval.lock().map_err(|_| UNAVAILABLE)?;
                let mut graph = self.graph_render.lock().map_err(|_| UNAVAILABLE)?;
                let before = registry.switch_status().map_err(attach_error)?.generation;
                let applied = registry.apply_switch(review).map_err(attach_error)?;
                if before != applied.generation {
                    recall.invalidate_owner_bindings();
                    *graph = GraphRenderHost::default();
                }
                Ok(HttpResponse::ok(json!(applied)))
            }
            _ => Err(INVALID),
        }
    }

    fn graph_render(
        &self,
        instance: &Instance,
        path: &str,
        bytes: &[u8],
    ) -> Result<HttpResponse, HttpError> {
        let operation = match path {
            GRAPH_RENDER_PREPARE => "prepare",
            GRAPH_RENDER_NODE_CHUNK => "node-chunk",
            GRAPH_RENDER_EDGE_CHUNK => "edge-chunk",
            GRAPH_RENDER_RESOLVE => "resolve",
            GRAPH_RENDER_INSPECT => "inspect",
            GRAPH_RENDER_NEIGHBORHOOD => "neighborhood",
            GRAPH_RENDER_LOCATE => "locate",
            GRAPH_RENDER_ELIGIBLE => "eligible",
            _ => return Err(INVALID),
        };
        self.graph_render.lock().map_err(|_| UNAVAILABLE)?.handle(
            operation,
            instance,
            &self.registry,
            bytes,
        )
    }

    fn runtime_attach(&self, bytes: &[u8]) -> Result<HttpResponse, HttpError> {
        let request: RuntimeAttachRequest = decode(bytes).map_err(|_| INVALID)?;
        if !request.valid() {
            return Err(INVALID);
        }
        if request.principal_id != self.principal_id {
            return Err(FORBIDDEN);
        }
        let candidate_lease_id = new_id().map_err(|_| UNAVAILABLE)?;
        let integration_kind = request.integration_kind.clone();
        let session_id = request.session_id.clone();
        let (lease_id, reconciliation_required) = self
            .runtimes
            .lock()
            .map_err(|_| UNAVAILABLE)?
            .attach(
                candidate_lease_id,
                integration_kind.clone(),
                request.runtime_id,
                request.principal_id,
                session_id,
            )
            .map_err(runtime_error)?;
        let reconciliation_required =
            self.recovery_scopes(&integration_kind, reconciliation_required)?;
        Ok(HttpResponse::ok(json!({
            "runtime_lease_id": lease_id,
            "heartbeat_interval_seconds": HEARTBEAT_SECONDS,
            "lease_expires_after_seconds": crate::runtime::EXPIRY_SECONDS,
            "reconciliation_required": reconciliation_required,
        })))
    }

    fn runtime_heartbeat(&self, bytes: &[u8]) -> Result<HttpResponse, HttpError> {
        let request: RuntimeLeaseRequest = decode(bytes).map_err(|_| INVALID)?;
        if !crate::service_protocol::valid_id(&request.lease_id) {
            return Err(INVALID);
        }
        self.runtimes
            .lock()
            .map_err(|_| UNAVAILABLE)?
            .heartbeat(&request.lease_id, &self.principal_id)
            .map_err(runtime_error)?;
        Ok(HttpResponse::ok(json!({"ok": true})))
    }

    fn runtime_scope(&self, bytes: &[u8]) -> Result<HttpResponse, HttpError> {
        let request: RuntimeScopeRequest = decode(bytes).map_err(|_| INVALID)?;
        if !crate::service_protocol::valid_id(&request.lease_id)
            || !crate::service_protocol::valid_id(&request.session_id)
        {
            return Err(INVALID);
        }
        let (integration_kind, scopes) = self
            .runtimes
            .lock()
            .map_err(|_| UNAVAILABLE)?
            .add_scope(&request.lease_id, &self.principal_id, request.session_id)
            .map_err(runtime_error)?;
        let reconciliation_required = self.recovery_scopes(&integration_kind, scopes)?;
        Ok(HttpResponse::ok(
            json!({"reconciliation_required": reconciliation_required}),
        ))
    }

    fn recovery_scopes(
        &self,
        integration_kind: &str,
        scopes: Vec<ReconciliationScope>,
    ) -> Result<Vec<ReconciliationScope>, HttpError> {
        if integration_kind != "hermes" || scopes.is_empty() {
            return Ok(scopes);
        }
        let sources = self.sources.lock().map_err(|_| UNAVAILABLE)?;
        let mut runtimes = self.runtimes.lock().map_err(|_| UNAVAILABLE)?;
        let mut pending = Vec::new();
        for scope in scopes {
            if sources.is_terminal(&scope.session_id)? {
                runtimes
                    .clear_fence(integration_kind, &scope.session_id, Some(scope.fence_epoch))
                    .map_err(|_| UNAVAILABLE)?;
            } else {
                pending.push(scope);
            }
        }
        Ok(pending)
    }

    fn runtime_detach(&self, bytes: &[u8]) -> Result<HttpResponse, HttpError> {
        let request: RuntimeDetachRequest = decode(bytes).map_err(|_| INVALID)?;
        if !request.clean || !crate::service_protocol::valid_id(&request.lease_id) {
            return Err(INVALID);
        }
        let mut runtimes = self.runtimes.lock().map_err(|_| UNAVAILABLE)?;
        let shutdown = runtimes
            .detach(&request.lease_id, &self.principal_id)
            .map_err(runtime_error)?;
        if shutdown {
            self.closing.store(true, Ordering::Release);
        }
        Ok(HttpResponse::ok(
            json!({"detached": true, "shutdown_ready": shutdown}),
        ))
    }

    fn dashboard_topology(
        &self,
        instance: &Instance,
        bytes: &[u8],
    ) -> Result<HttpResponse, HttpError> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            profile_id: String,
            principal_id: String,
            #[serde(deserialize_with = "required_nullable")]
            session_id: Option<String>,
            owners_fingerprint: Option<String>,
        }
        fn required_nullable<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
        where
            D: serde::Deserializer<'de>,
        {
            Option::<String>::deserialize(deserializer)
        }
        let request: Request = decode(bytes).map_err(|_| INVALID)?;
        if request.profile_id != self.discovery.profile_id
            || request.principal_id != self.principal_id
        {
            return Err(FORBIDDEN);
        }
        if let Some(fingerprint) = request.owners_fingerprint {
            if fingerprint.len() != 64
                || !fingerprint
                    .bytes()
                    .all(|byte| b"0123456789abcdef".contains(&byte))
            {
                return Err(INVALID);
            }
            if fingerprint != self.bootstrap_fingerprint {
                return Err(HttpError::new(409, "service_restart_required", false));
            }
        }
        let registry = self.registry.lock().map_err(|_| UNAVAILABLE)?;
        let body = registry
            .dashboard_topology(instance, request.session_id.as_deref())
            .map_err(attach_error)?;
        Ok(HttpResponse::ok(body))
    }

    fn attach(&self, instance: &Instance, bytes: &[u8]) -> Result<HttpResponse, HttpError> {
        let request: AttachRequest = decode(bytes).map_err(|_| INVALID)?;
        if !request.valid() {
            return Err(INVALID);
        }
        if request.discovery != self.discovery {
            return Err(HttpError::new(409, "discovery_mismatch", false));
        }
        if request.principal_id != self.principal_id {
            return Err(FORBIDDEN);
        }
        let mut registry = self.registry.lock().map_err(|_| UNAVAILABLE)?;
        let binding = registry
            .bind_session(&request.session_id, request.project_id.as_deref())
            .map_err(attach_error)?;
        if let Ok(mut sources) = self.sources.try_lock() {
            sources.resume(instance, &registry, &request.session_id, |owner| {
                self.ensure_embedding_owner(instance, owner).is_ok()
            });
        }
        Ok(HttpResponse::ok(json!({
            "discovery": self.discovery,
            "session_id": binding.session_id,
            "rel_id": binding.rel_id,
            "user_id": binding.user_id,
        })))
    }

    fn source_status(&self, instance: &Instance, bytes: &[u8]) -> Result<HttpResponse, HttpError> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            profile_id: String,
            principal_id: String,
            session_id: String,
        }
        let request: Request = decode(bytes).map_err(|_| INVALID)?;
        if request.profile_id != self.discovery.profile_id
            || request.principal_id != self.principal_id
        {
            return Err(FORBIDDEN);
        }
        if !crate::service_protocol::valid_id(&request.session_id) {
            return Err(INVALID);
        }
        let registry = self.registry.lock().map_err(|_| UNAVAILABLE)?;
        let sources = self.sources.lock().map_err(|_| UNAVAILABLE)?;
        let mut runtimes = self.runtimes.lock().map_err(|_| UNAVAILABLE)?;
        let mut status =
            sources.import_status(&request.session_id, instance, &registry, &mut runtimes)?;
        let owner = status["owner_id"]
            .as_str()
            .and_then(|value| value.parse::<reliquary_memory::OwnerId>().ok());
        let embedding_error = match owner {
            Some(owner) if status["state"] != "tombstoned" && status["state"] != "none" => {
                match self.inference.embedding_binding() {
                    Err(code) => Some(code),
                    Ok(identity) => self
                        .embedding_bindings
                        .status_owner(owner, &identity, || {
                            instance.has_active_vectors(owner).map_err(|_| ())
                        })
                        .unwrap_or(Some("embedding_identity_unavailable")),
                }
            }
            _ => None,
        };
        apply_embedding_status(&mut status, embedding_error);
        Ok(HttpResponse::ok(status))
    }

    fn source(&self, instance: &Instance, bytes: &[u8]) -> Result<HttpResponse, HttpError> {
        let request = SourceRequest::parse(bytes)?;
        if request.profile_id != self.discovery.profile_id
            || request.principal_id != self.principal_id
        {
            return Err(FORBIDDEN);
        }
        // Registry -> source -> runtime is the established lock order. The
        // manual source route is immutable and independent of recall routing.
        let registry = self.registry.lock().map_err(|_| UNAVAILABLE)?;
        let mut sources = self.sources.lock().map_err(|_| UNAVAILABLE)?;
        let prior_source_owner = sources.source_owner(&request.session_id)?;
        let expected_phy = request
            .expected_phy_id
            .as_deref()
            .map(str::parse::<OwnerId>)
            .transpose()
            .map_err(|_| INVALID)?;
        let phy = if prior_source_owner.is_some() {
            sources
                .source_phy(&request.session_id)?
                .unwrap_or_else(|| registry.legacy_phy())
        } else if request.operation.is_manual() {
            expected_phy.unwrap_or_else(|| registry.legacy_phy())
        } else if request.operation == SourceAction::Snapshot {
            registry
                .session_phy(&request.session_id)
                .map_err(attach_error)?
        } else {
            registry.active_phy()
        };
        if expected_phy.is_some_and(|expected| expected != phy) {
            return Err(HttpError::new(409, "source_phy_conflict", false));
        }
        if phy != registry.active_phy() {
            return Err(HttpError::new(409, "source_phy_inactive", true));
        }
        let owner = if request.operation.is_manual() {
            // Manual work is pinned by the authenticated profile before enqueue.
            // Its original REL can become retained before the first delivery.
            let target = request.target_owner_id.as_deref().ok_or(INVALID)?;
            let selected = if prior_source_owner.is_some() || expected_phy.is_some() {
                registry.retained_source_owner(target)
            } else {
                registry.legacy_source_owner(target)
            }
            .map_err(attach_error)?;
            let accepted_source_owner = if prior_source_owner.is_some() {
                prior_source_owner
            } else if sources.has_source_head(&request.session_id)? {
                Some(
                    registry
                        .source_owner(&request.session_id, true)
                        .map_err(attach_error)?,
                )
            } else {
                None
            };
            if accepted_source_owner.is_some_and(|prior| prior != selected) {
                return Err(HttpError::new(409, "source_owner_conflict", false));
            }
            selected
        } else if let Some(source_owner) = prior_source_owner {
            if request.operation == SourceAction::Snapshot
                && registry
                    .source_owner(&request.session_id, true)
                    .map_err(attach_error)?
                    != source_owner
            {
                return Err(HttpError::new(409, "source_owner_conflict", false));
            }
            source_owner
        } else {
            registry
                .source_owner(
                    &request.session_id,
                    request.operation == SourceAction::Snapshot,
                )
                .map_err(attach_error)?
        };
        let mut runtimes = self.runtimes.lock().map_err(|_| UNAVAILABLE)?;
        let (fenced, eligible_epoch) = if let Some(lease_id) = request.lease_id.as_deref() {
            let (kind, fenced, eligible_epoch) = runtimes
                .authorize_scope(lease_id, &request.principal_id, &request.session_id)
                .map_err(runtime_error)?;
            if kind != "hermes" {
                return Err(FORBIDDEN);
            }
            (fenced, eligible_epoch)
        } else {
            let fenced = runtimes
                .has_fence("hermes", &request.session_id)
                .map_err(runtime_error)?;
            (fenced, None)
        };
        if fenced && request.fence_epoch.is_some() && request.fence_epoch != eligible_epoch {
            return Err(HttpError::new(409, "source_fence_epoch_stale", false));
        }

        let source_removed = request.operation == SourceAction::Rewind
            || (request.operation == SourceAction::Terminal
                && request.arguments["reason"] == "delete");
        let invalidate_retrieval = !request.operation.is_snapshot();
        let reconcile = request.fence_epoch.is_some();
        let session_id = request.session_id.clone();
        let binding = SourceBinding {
            rel: owner,
            phy,
            processor: registry.source_processor(),
            admitted_capture: request.operation == SourceAction::Snapshot
                && request.lease_id.is_some(),
        };
        let response = sources.handle(instance, binding, request, fenced, || {
            self.ensure_embedding_owner(instance, owner)
        });
        if reconcile && response.is_ok() && eligible_epoch.is_some() {
            runtimes
                .clear_fence("hermes", &session_id, eligible_epoch)
                .map_err(|_| UNAVAILABLE)?;
        }
        // Clear the transient fence only after the durable source change is acknowledged.
        if source_removed && response.is_ok() {
            let current = runtimes
                .current_fence_epoch("hermes", &session_id)
                .map_err(runtime_error)?;
            runtimes
                .clear_fence("hermes", &session_id, current)
                .map_err(|_| UNAVAILABLE)?;
        }
        drop(runtimes);
        drop(sources);
        if response.is_ok() && invalidate_retrieval {
            self.invalidate_retrieval(instance, &session_id);
        }
        response
    }

    fn prepare_retrieval(
        &self,
        instance: &Instance,
        bytes: &[u8],
    ) -> Result<HttpResponse, HttpError> {
        let request: ProviderRequest = decode(bytes).map_err(|_| INVALID)?;
        if !request.valid() {
            return Err(INVALID);
        }
        if request.profile_id != self.discovery.profile_id
            || request.principal_id != self.principal_id
        {
            return Err(FORBIDDEN);
        }
        if let Some(code) = self.inference.unavailable_code() {
            return Err(HttpError::new(503, code, true));
        }
        let registry = self.registry.lock().map_err(|_| UNAVAILABLE)?;
        let owner = registry
            .source_owner(&request.session_id, true)
            .map_err(attach_error)?;
        let phy = registry.active_phy_recall();
        drop(registry);
        self.ensure_embedding_owner(instance, owner)?;
        let permit = RetrievalPermit::acquire(&self.retrieval_busy).ok_or(RETRIEVAL_BUSY)?;
        let mut slot = self.retrieval.try_lock().map_err(|_| UNAVAILABLE)?;
        let mut work = slot.take_for_work();
        drop(slot);
        let response = work.prepare(&request, bytes, instance, owner, phy);
        self.restore_retrieval(instance, work)?;
        drop(permit);
        response
    }

    fn wait_for_retrieval(
        &self,
        deadline: Instant,
    ) -> Result<(MutexGuard<'_, RetrievalService>, RetrievalPermit<'_>), HttpError> {
        // Let one explicit recall wait behind a slow prefetch. Other workers
        // remain available for lease heartbeats and unrelated service requests.
        let _waiter = self
            .retrieval_waiter
            .try_lock()
            .map_err(|_| RETRIEVAL_BUSY)?;
        while Instant::now() < deadline {
            if self.retrieval_busy.load(Ordering::Acquire) {
                thread::sleep(Duration::from_millis(25));
                continue;
            }
            let Some(permit) = RetrievalPermit::acquire(&self.retrieval_busy) else {
                continue;
            };
            match self.retrieval.try_lock() {
                Ok(retrieval) => return Ok((retrieval, permit)),
                Err(TryLockError::WouldBlock) => {
                    drop(permit);
                    thread::sleep(Duration::from_millis(25));
                }
                Err(TryLockError::Poisoned(_)) => return Err(UNAVAILABLE),
            }
        }
        Err(UNAVAILABLE)
    }

    fn request(
        &self,
        instance: &Instance,
        bytes: &[u8],
        accepted_at: Instant,
        explicit_recall: bool,
    ) -> Result<HttpResponse, HttpError> {
        let request: ProviderRequest = decode(bytes).map_err(|_| INVALID)?;
        if !request.valid() {
            return Err(INVALID);
        }
        if request.profile_id != self.discovery.profile_id
            || request.principal_id != self.principal_id
        {
            return Ok(HttpResponse::ok(request.error("denied", "denied", false)));
        }
        let registry = self.registry.lock().map_err(|_| UNAVAILABLE)?;
        let response = match registry.is_bound(&request.session_id) {
            Ok(true) => match request.operation {
                Operation::OwnerStatus => {
                    match registry.owner_status(instance, &request.session_id) {
                        Ok(status) => request.response("ok", json!(status)),
                        Err(error) => {
                            request.error(error.status(), error.code(), error.retryable())
                        }
                    }
                }
                Operation::EditMemory => request.error("denied", "user_channel_required", false),
                Operation::SnapshotSubmit => {
                    request.error("unavailable", "source_ingest_unavailable", false)
                }
                Operation::MemoryQuery | Operation::RefineQuery | Operation::TraverseGraph => {
                    if let Some(code) = self.inference.unavailable_code() {
                        return Ok(HttpResponse::ok(request.error("unavailable", code, true)));
                    }
                    let owner = match registry.source_owner(&request.session_id, true) {
                        Ok(owner) => owner,
                        Err(error) => {
                            return Ok(HttpResponse::ok(request.error(
                                error.status(),
                                error.code(),
                                error.retryable(),
                            )));
                        }
                    };
                    let phy = registry.active_phy_recall();
                    drop(registry);
                    if let Err(error) = self.ensure_embedding_owner(instance, owner) {
                        return Ok(HttpResponse::ok(request.error(
                            "unavailable",
                            error.code(),
                            error.retryable(),
                        )));
                    }
                    let (retrieval_deadline, retrieval) = if explicit_recall {
                        let deadline = accepted_at + RETRIEVAL_TOOL_BUDGET;
                        (deadline, self.wait_for_retrieval(deadline))
                    } else {
                        let permit =
                            RetrievalPermit::acquire(&self.retrieval_busy).ok_or(RETRIEVAL_BUSY);
                        let guard = permit.and_then(|permit| {
                            self.retrieval
                                .try_lock()
                                .map(|guard| (guard, permit))
                                .map_err(|_| RETRIEVAL_BUSY)
                        });
                        (accepted_at + PREFETCH_BUDGET, guard)
                    };
                    let (mut retrieval, permit) = match retrieval {
                        Ok(retrieval) => retrieval,
                        Err(error) => {
                            return Ok(HttpResponse::ok(request.error(
                                "unavailable",
                                error.code(),
                                error.retryable(),
                            )));
                        }
                    };
                    let mut work = retrieval.take_for_work();
                    drop(retrieval);
                    let result = work.request(
                        &request,
                        bytes,
                        instance,
                        &self.registry,
                        owner,
                        phy,
                        &self.sources,
                        &self.runtimes,
                        retrieval_deadline,
                    );
                    self.restore_retrieval(instance, work)?;
                    drop(permit);
                    return match result {
                        Ok(body) => Ok(HttpResponse::ok(body)),
                        Err(error) => Ok(HttpResponse::ok(request.error(
                            match error.status_code() {
                                400 => "invalid",
                                403 => "denied",
                                409 => "conflict",
                                501 => "unsupported",
                                _ => "unavailable",
                            },
                            error.code(),
                            error.retryable(),
                        ))),
                    };
                }
                Operation::InspectMemory => {
                    request.error("unavailable", "inspection_unavailable", false)
                }
            },
            Ok(false) => request.error("denied", "session_unbound", false),
            Err(error) => request.error(error.status(), error.code(), error.retryable()),
        };
        Ok(HttpResponse::ok(response))
    }
}

fn owner_gate_error<T>(error: TryLockError<T>) -> HttpError {
    match error {
        TryLockError::WouldBlock => OWNER_SWITCH_BUSY,
        TryLockError::Poisoned(_) => UNAVAILABLE,
    }
}

pub(crate) fn setup_status(state_dir: &Path) -> Result<(), &'static str> {
    if !state_dir.is_absolute() {
        return Err("invalid_state_directory");
    }
    let topology = committed_switch_status(state_dir).map_err(|error| error.code())?;
    let mut stdout = io::stdout().lock();
    serde_json::to_writer(&mut stdout, &json!({"topology": topology}))
        .map_err(|_| "state_unavailable")?;
    stdout.write_all(b"\n").map_err(|_| "state_unavailable")
}

fn bind_identity_runtime<T>(
    gate: &Mutex<()>,
    broker: &Broker,
    body: &[u8],
    profile: &str,
    instance: &str,
    lease: &str,
    install: impl FnOnce(Arc<reliquary_memory::ConfiguredRuntime>, u64) -> Result<T, HttpError>,
) -> Result<(HttpResponse, T), HttpError> {
    let _gate = gate.lock().map_err(|_| UNAVAILABLE)?;
    let response = broker.handle(IDENTITY, body, profile, instance, lease)?;
    let runtime = broker.bind_runtime().map_err(|_| UNAVAILABLE)?;
    let epoch = match &response.body {
        crate::service_http::ResponseBody::Json { value, .. } => {
            value["lease_epoch"].as_u64().ok_or(UNAVAILABLE)?
        }
        crate::service_http::ResponseBody::Binary(_) => return Err(UNAVAILABLE),
    };
    let installed = install(runtime, epoch)?;
    Ok((response, installed))
}

fn reserved_worker_path(path: &str) -> bool {
    path.starts_with("/v1/inference/")
        || matches!(
            path,
            ATTACH
                | DASHBOARD_TOPOLOGY
                | RUNTIME_ATTACH
                | RUNTIME_HEARTBEAT
                | RUNTIME_DETACH
                | RUNTIME_SCOPE
        )
}

fn apply_embedding_status(status: &mut serde_json::Value, error: Option<&'static str>) {
    if let Some(code) = error {
        status["state"] = json!("unavailable");
        status["embedding_error"] = json!(code);
    } else {
        status["embedding_error"] = serde_json::Value::Null;
    }
}

fn admit_worker_request(path: &str, blocking_workers: &AtomicUsize) -> bool {
    reserved_worker_path(path)
        || blocking_workers
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
                (active < 2).then_some(active + 1)
            })
            .is_ok()
}

#[cfg(test)]
mod admission_tests {
    use super::*;
    use std::sync::atomic::AtomicU64;

    #[test]
    fn two_model_waiters_leave_worker_and_runtime_control_paths_available() {
        let active = AtomicUsize::new(0);
        assert!(admit_worker_request("/v1/request", &active));
        assert!(admit_worker_request(RETRIEVAL_PREPARE, &active));
        assert!(!admit_worker_request("/v1/request", &active));
        assert_eq!(active.load(Ordering::Acquire), 2);

        for path in [
            "/v1/inference/claim",
            "/v1/inference/result-part",
            RUNTIME_ATTACH,
            RUNTIME_HEARTBEAT,
            RUNTIME_DETACH,
            RUNTIME_SCOPE,
            ATTACH,
            DASHBOARD_TOPOLOGY,
        ] {
            assert!(admit_worker_request(path, &active), "{path}");
        }
        assert_eq!(active.load(Ordering::Acquire), 2);
    }

    #[test]
    fn embedding_identity_errors_are_visible_without_hiding_accepted_receipts() {
        let mut status = json!({"state":"complete","receipt":"accepted"});
        apply_embedding_status(&mut status, Some("embedding_identity_stale"));
        assert_eq!(status["state"], "unavailable");
        assert_eq!(status["embedding_error"], "embedding_identity_stale");
        assert_eq!(status["receipt"], "accepted");
    }

    #[test]
    fn concurrent_identity_applies_install_the_current_runtime_epoch() {
        let gate = Arc::new(Mutex::new(()));
        let broker = Arc::new(Broker::new());
        let installed_epoch = Arc::new(AtomicU64::new(0));
        let first_started = Arc::new(AtomicBool::new(false));
        let first_gate = Arc::clone(&gate);
        let first_broker = Arc::clone(&broker);
        let first_installed = Arc::clone(&installed_epoch);
        let started = Arc::clone(&first_started);
        let first = thread::spawn(move || {
            let body = identity_body("0000000000000000000000000000000a", "generation-a");
            bind_identity_runtime(
                &first_gate,
                &first_broker,
                &serde_json::to_vec(&body).unwrap(),
                "profile-one",
                "instance-one",
                "lease-one",
                |runtime, epoch| {
                    let _runtime = runtime;
                    started.store(true, Ordering::Release);
                    thread::sleep(Duration::from_millis(40));
                    first_installed.store(epoch, Ordering::Release);
                    Ok(())
                },
            )
            .unwrap()
            .0
        });
        let second_gate = Arc::clone(&gate);
        let second_broker = Arc::clone(&broker);
        let second_installed = Arc::clone(&installed_epoch);
        let second = thread::spawn(move || {
            while !first_started.load(Ordering::Acquire) {
                thread::sleep(Duration::from_millis(1));
            }
            let body = identity_body("0000000000000000000000000000000b", "generation-b");
            bind_identity_runtime(
                &second_gate,
                &second_broker,
                &serde_json::to_vec(&body).unwrap(),
                "profile-one",
                "instance-one",
                "lease-one",
                |runtime, epoch| {
                    let _runtime = runtime;
                    second_installed.store(epoch, Ordering::Release);
                    Ok(())
                },
            )
            .unwrap()
            .0
        });
        let _first_response = first.join().unwrap();
        let second_response = second.join().unwrap();
        let current_epoch = match second_response.body {
            crate::service_http::ResponseBody::Json { value, .. } => {
                value["lease_epoch"].as_u64().unwrap()
            }
            crate::service_http::ResponseBody::Binary(_) => panic!("identity is JSON"),
        };
        assert_eq!(installed_epoch.load(Ordering::Acquire), current_epoch);
    }

    fn identity_body(worker_id: &str, generation_model: &str) -> serde_json::Value {
        json!({
            "worker_id": worker_id,
            "profile_id": "profile-one",
            "instance_id": "instance-one",
            "service_lease_id": "lease-one",
            "general": {"provider": "openai-api", "model": generation_model},
            "embedding": {
                "provider": "openai-api",
                "model": "text-embedding-3-small",
                "dimensions": 3,
                "input_type_handling": "shared",
                "normalization": "none"
            }
        })
    }
}

struct RetrievalPermit<'a>(&'a AtomicBool);

impl<'a> RetrievalPermit<'a> {
    fn acquire(flag: &'a AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self(flag))
    }
}

impl Drop for RetrievalPermit<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn attach_error(error: RegistryError) -> HttpError {
    let status = match error.status() {
        "invalid" => 400,
        "denied" => 403,
        "conflict" => 409,
        _ => 503,
    };
    HttpError::new(status, error.code(), error.retryable())
}

fn runtime_error(code: &'static str) -> HttpError {
    match code {
        "runtime_lease_denied" => FORBIDDEN,
        "runtime_lease_stale" => HttpError::new(409, code, false),
        "host_closing" => UNAVAILABLE,
        "invalid" => INVALID,
        _ => UNAVAILABLE,
    }
}

fn read_bounded(reader: impl Read, limit: usize) -> Result<Vec<u8>, &'static str> {
    let mut bytes = Vec::new();
    reader
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "input_unavailable")?;
    if bytes.len() > limit {
        return Err("input_limit");
    }
    Ok(bytes)
}

fn bootstrap() -> Result<Bootstrap, &'static str> {
    let bytes = read_bounded(io::stdin().lock(), BOOTSTRAP_LIMIT)?;
    let bootstrap: Bootstrap = decode(&bytes).map_err(|_| "invalid_bootstrap")?;
    if !(32..=512).contains(&bootstrap.token.len())
        || !bootstrap.token.bytes().all(|byte| byte.is_ascii_graphic())
    {
        return Err("invalid_bootstrap");
    }
    Ok(bootstrap)
}

fn config(state_dir: &Path) -> Result<(OwnerConfig, String), &'static str> {
    if !state_dir.is_absolute() || !state_dir.symlink_metadata().is_ok_and(|meta| meta.is_dir()) {
        return Err("invalid_state_directory");
    }
    let path = state_dir.join("owners.json");
    if !path.symlink_metadata().is_ok_and(|meta| meta.is_file()) {
        return Err("invalid_owner_config");
    }
    let file = File::open(path).map_err(|_| "invalid_owner_config")?;
    let bytes = read_bounded(file, MAX_WIRE_BYTES)?;
    let owners = decode(&bytes).map_err(|_| "invalid_owner_config")?;
    Ok((owners, hex(&Sha256::digest(&bytes))))
}

fn new_id() -> Result<String, &'static str> {
    let mut id = [0; 16];
    getrandom::fill(&mut id).map_err(|_| "entropy_unavailable")?;
    Ok(hex(&id))
}

fn publish_discovery(state_dir: &Path, discovery: &Discovery) -> Result<(), &'static str> {
    let temporary = state_dir.join(format!(".discovery-{}.tmp", discovery.lease_id));
    let destination = state_dir.join("discovery.json");
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|_| "discovery_unavailable")?;
    let write = serde_json::to_writer(&mut file, discovery)
        .map_err(io::Error::other)
        .and_then(|()| file.write_all(b"\n"))
        .and_then(|()| file.sync_all());
    drop(file);
    if write
        .and_then(|()| fs::rename(&temporary, destination))
        .is_err()
    {
        let _ = fs::remove_file(&temporary);
        return Err("discovery_unavailable");
    }
    Ok(())
}

pub(crate) fn run(state_dir: &Path) -> Result<(), &'static str> {
    let (config, bootstrap_fingerprint) = config(state_dir)?;
    let bootstrap = bootstrap()?;
    // Opening the registry takes its service lease before mounting any REL.
    let registry = Registry::open(config, state_dir, &new_id()?).map_err(|error| error.code())?;
    let listener =
        TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|_| "loopback_unavailable")?;
    let expected_host = listener
        .local_addr()
        .map_err(|_| "loopback_unavailable")?
        .to_string();
    let discovery = Discovery {
        endpoint: format!("http://{expected_host}/"),
        instance_id: new_id()?,
        profile_id: registry.profile_id().to_owned(),
        protocol_version: PROTOCOL_VERSION,
        hermes_revision: HERMES_REVISION.into(),
        lease_id: new_id()?,
    };
    let key = TransportKey::derive(
        &bootstrap.token,
        &discovery.instance_id,
        &discovery.lease_id,
    );
    let runtimes = RuntimeRegistry::open(state_dir)?;
    let sources = SourceService::open(state_dir)?;
    let service = Arc::new(Service {
        expected_host,
        discovery,
        principal_id: registry.principal_id().to_owned(),
        bootstrap_fingerprint,
        key,
        registry: Mutex::new(registry),
        sources: Mutex::new(sources),
        retrieval: Mutex::new(RetrievalService::open(state_dir)?),
        graph_render: Mutex::new(GraphRenderHost::default()),
        retrieval_waiter: Mutex::new(()),
        retrieval_busy: AtomicBool::new(false),
        deferred_invalidations: Mutex::new(BTreeSet::new()),
        inference: Broker::new(),
        runtime_binding: Mutex::new(()),
        embedding_bindings: EmbeddingBindingStore::open(state_dir)?,
        blocking_workers: AtomicUsize::new(0),
        runtimes: Mutex::new(runtimes),
        closing: AtomicBool::new(false),
        inflight: AtomicUsize::new(0),
        owner_requests: RwLock::new(()),
    });
    drop(bootstrap);

    let (sender, receiver) = sync_channel::<(TcpStream, Instant)>(QUEUE_CAPACITY);
    let receiver = Arc::new(Mutex::new(receiver));
    let mut workers = Vec::new();
    for _ in 0..WORKERS {
        let service = Arc::clone(&service);
        let receiver = Arc::clone(&receiver);
        workers.push(
            thread::Builder::new()
                .spawn(move || {
                    loop {
                        let received = {
                            let Ok(receiver) = receiver.lock() else { break };
                            receiver.recv()
                        };
                        let Ok((socket, accepted_at)) = received else {
                            break;
                        };
                        service.connection(socket, accepted_at);
                        service.inflight.fetch_sub(1, Ordering::AcqRel);
                    }
                })
                .map_err(|_| "worker_unavailable")?,
        );
    }
    publish_discovery(state_dir, &service.discovery)?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "loopback_unavailable")?;
    let mut next_source_resume = Instant::now() + Duration::from_secs(5);
    loop {
        if let Ok(_binding) = service.runtime_binding.try_lock()
            && service.inference.native_epoch().is_none()
            && let Ok(mut registry) = service.registry.try_lock()
        {
            let _ = registry.set_ego_runtime(None);
            let _ = registry.set_perception_runtime(None);
        }
        // Expiry is a liveness event, not an idle-time event. Persist fences
        // even while no client is currently talking to the host.
        if let Ok(mut runtimes) = service.runtimes.lock() {
            let _ = runtimes.expire();
        }
        if let Ok(mut graph_render) = service.graph_render.try_lock() {
            graph_render.expire();
        }
        if Instant::now() >= next_source_resume {
            if let Ok(_permit) = service.owner_requests.try_read()
                && let Ok(registry) = service.registry.try_lock()
                && let Ok(instance) = registry.instance()
                && let Ok(mut sources) = service.sources.try_lock()
                && let Ok(mut runtimes) = service.runtimes.try_lock()
            {
                let _ = sources.resume_all(&instance, &registry, &mut runtimes, |owner| {
                    service.ensure_embedding_owner(&instance, owner).is_ok()
                });
            }
            next_source_resume = Instant::now() + Duration::from_secs(5);
        }
        if service.closing.load(Ordering::Acquire) {
            if service.inflight.load(Ordering::Acquire) == 0
                && service
                    .runtimes
                    .lock()
                    .map_err(|_| "runtime_state_unavailable")?
                    .should_shutdown()?
            {
                break;
            }
            thread::sleep(std::time::Duration::from_millis(100));
            continue;
        }
        match listener.accept() {
            Ok((socket, _)) => {
                // Accepted Winsock streams can inherit the listener's mode.
                // Workers use blocking I/O with per-request deadlines.
                if socket.set_nonblocking(false).is_err() {
                    continue;
                }
                service.inflight.fetch_add(1, Ordering::AcqRel);
                match sender.try_send((socket, Instant::now())) {
                    Ok(()) => {}
                    Err(TrySendError::Full((mut socket, _))) => {
                        service.inflight.fetch_sub(1, Ordering::AcqRel);
                        let _ = write_response(&mut socket, UNAVAILABLE.into_response(), None);
                    }
                    Err(TrySendError::Disconnected(_)) => return Err("worker_unavailable"),
                }
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(std::time::Duration::from_millis(100))
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return Err("loopback_unavailable"),
        }
    }
    service.inference.stop();
    if let Ok(mut registry) = service.registry.lock() {
        let _ = registry.set_ego_runtime(None);
        let _ = registry.set_perception_runtime(None);
    }
    drop(sender);
    for worker in workers {
        let _ = worker.join();
    }
    let _ = fs::remove_file(state_dir.join("discovery.json"));
    Ok(())
}
