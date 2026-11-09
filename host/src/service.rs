//! One profile-scoped local service and its owner registry.
use crate::{
    registry::{OwnerConfig, Registry, RegistryError},
    retrieval::RetrievalService,
    runtime::{HEARTBEAT_SECONDS, ReconciliationScope, RuntimeRegistry},
    service_http::{
        ATTACH, DASHBOARD_TOPOLOGY, FORBIDDEN, HttpError, HttpRequest, HttpResponse, INVALID, MAX_WIRE_BYTES,
        RETRIEVAL_PREPARE, RUNTIME_ATTACH, RUNTIME_DETACH, RUNTIME_HEARTBEAT, RUNTIME_SCOPE,
        SOURCE, TransportKey, UNAVAILABLE, hex, read_request, write_response,
    },
    service_protocol::{
        AttachRequest, Discovery, HERMES_REVISION, Operation, PROTOCOL_VERSION, ProviderRequest,
        RuntimeAttachRequest, RuntimeDetachRequest, RuntimeLeaseRequest, RuntimeScopeRequest,
        decode,
    },
    source_ingest::SourceService,
    source_wire::{SourceAction, SourceRequest},
};
use reliquary_memory::Instance;
use serde::Deserialize;
use serde_json::json;
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    net::{Ipv4Addr, TcpListener, TcpStream},
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc::{TrySendError, sync_channel},
    },
    thread,
    time::Instant,
};

const WORKERS: usize = 4;
const QUEUE_CAPACITY: usize = 8;
const BOOTSTRAP_LIMIT: usize = 4096;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Bootstrap {
    token: String,
}

struct Service {
    expected_host: String,
    discovery: Discovery,
    principal_id: String,
    key: TransportKey,
    sources: Mutex<SourceService>,
    retrieval: Mutex<RetrievalService>,
    runtimes: Mutex<RuntimeRegistry>,
    closing: AtomicBool,
    inflight: AtomicUsize,
    instance: Instance,
    // Drop the source service (and join its jobs) before releasing owner leases.
    registry: Mutex<Registry>,
}

impl Service {
    fn connection(&self, mut socket: TcpStream, accepted_at: Instant) {
        match read_request(&mut socket, accepted_at, &self.expected_host, &self.key) {
            Ok(request) => {
                let response = self
                    .dispatch(&request, accepted_at)
                    .unwrap_or_else(HttpError::into_response);
                let _ = write_response(&mut socket, response, Some((&self.key, &request.nonce)));
            }
            Err(error) => {
                let _ = write_response(&mut socket, error.into_response(), None);
            }
        }
    }

    fn dispatch(
        &self,
        request: &HttpRequest,
        accepted_at: Instant,
    ) -> Result<HttpResponse, HttpError> {
        if self.closing.load(Ordering::Acquire) {
            return Err(UNAVAILABLE);
        }
        match request.path {
            ATTACH => self.attach(&request.body),
            SOURCE => self.source(&request.body),
            DASHBOARD_TOPOLOGY => self.dashboard_topology(&request.body),
            RETRIEVAL_PREPARE => self.prepare_retrieval(&request.body),
            RUNTIME_ATTACH => self.runtime_attach(&request.body),
            RUNTIME_HEARTBEAT => self.runtime_heartbeat(&request.body),
            RUNTIME_DETACH => self.runtime_detach(&request.body),
            RUNTIME_SCOPE => self.runtime_scope(&request.body),
            _ => self.request(&request.body, accepted_at),
        }
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

    fn dashboard_topology(&self, bytes: &[u8]) -> Result<HttpResponse, HttpError> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Request {
            profile_id: String,
            principal_id: String,
            #[serde(deserialize_with = "required_nullable")]
            session_id: Option<String>,
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
        let registry = self.registry.lock().map_err(|_| UNAVAILABLE)?;
        let body = registry
            .dashboard_topology(&self.instance, request.session_id.as_deref())
            .map_err(attach_error)?;
        Ok(HttpResponse::ok(body))
    }

    fn attach(&self, bytes: &[u8]) -> Result<HttpResponse, HttpError> {
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
        let (binding, owner) = {
            let mut registry = self.registry.lock().map_err(|_| UNAVAILABLE)?;
            let binding = registry
                .bind_session(&request.session_id)
                .map_err(attach_error)?;
            let owner = registry
                .source_owner(&request.session_id, true)
                .map_err(attach_error)?;
            (binding, owner)
        };
        if let Ok(mut sources) = self.sources.try_lock() {
            sources.resume(&self.instance, owner, &request.session_id);
        }
        Ok(HttpResponse::ok(json!({
            "discovery": self.discovery,
            "session_id": binding.session_id,
            "rel_id": binding.rel_id,
            "user_id": binding.user_id,
        })))
    }

    fn source(&self, bytes: &[u8]) -> Result<HttpResponse, HttpError> {
        let request = SourceRequest::parse(bytes)?;
        if request.profile_id != self.discovery.profile_id
            || request.principal_id != self.principal_id
        {
            return Err(FORBIDDEN);
        }
        let owner = self
            .registry
            .lock()
            .map_err(|_| UNAVAILABLE)?
            .source_owner(
                &request.session_id,
                request.operation == SourceAction::Snapshot,
            )
            .map_err(attach_error)?;
        // Preserve the source-before-runtime lock order. The source lock stays
        // held through commit and fence clearing so an expiry cannot race a
        // fresh authoritative snapshot.
        let mut sources = self.sources.lock().map_err(|_| UNAVAILABLE)?;
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

        let terminal = request.operation == SourceAction::Terminal;
        let invalidate_retrieval = request.operation != SourceAction::Snapshot;
        let reconcile = request.fence_epoch.is_some();
        let session_id = request.session_id.clone();
        let response = sources.handle(&self.instance, owner, request, fenced);
        if reconcile && response.is_ok() && eligible_epoch.is_some() {
            runtimes
                .clear_fence("hermes", &session_id, eligible_epoch)
                .map_err(|_| UNAVAILABLE)?;
        }
        // An authenticated terminal notice can settle the runtime fence once
        // the source tombstone is durable, even if native maintenance is pending.
        if terminal && sources.is_terminal(&session_id)? {
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
            if let Ok(mut retrieval) = self.retrieval.try_lock() {
                retrieval.invalidate_session(&session_id, &self.instance);
            }
        }
        response
    }

    fn prepare_retrieval(&self, bytes: &[u8]) -> Result<HttpResponse, HttpError> {
        let request: ProviderRequest = decode(bytes).map_err(|_| INVALID)?;
        if !request.valid() {
            return Err(INVALID);
        }
        if request.profile_id != self.discovery.profile_id
            || request.principal_id != self.principal_id
        {
            return Err(FORBIDDEN);
        }
        let registry = self.registry.lock().map_err(|_| UNAVAILABLE)?;
        let owner = registry
            .source_owner(&request.session_id, true)
            .map_err(attach_error)?;
        drop(registry);
        self.retrieval.try_lock().map_err(|_| UNAVAILABLE)?.prepare(
            &request,
            bytes,
            &self.instance,
            owner,
        )
    }

    fn request(&self, bytes: &[u8], accepted_at: Instant) -> Result<HttpResponse, HttpError> {
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
                Operation::OwnerStatus => match registry
                    .owner_status(&self.instance, &request.session_id)
                {
                    Ok(status) => request.response("ok", json!(status)),
                    Err(error) => request.error(error.status(), error.code(), error.retryable()),
                },
                Operation::EditMemory => request.error("denied", "user_channel_required", false),
                Operation::SnapshotSubmit => {
                    request.error("unavailable", "source_ingest_unavailable", false)
                }
                Operation::MemoryQuery | Operation::RefineQuery | Operation::TraverseGraph => {
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
                    drop(registry);
                    let mut retrieval = match self.retrieval.try_lock() {
                        Ok(retrieval) => retrieval,
                        Err(_) => {
                            return Ok(HttpResponse::ok(request.error(
                                "unavailable",
                                "retrieval_busy",
                                true,
                            )));
                        }
                    };
                    return match retrieval.request(
                        &request,
                        bytes,
                        &self.instance,
                        &self.registry,
                        owner,
                        &self.sources,
                        &self.runtimes,
                        accepted_at + std::time::Duration::from_millis(6500),
                    ) {
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

fn config(state_dir: &Path) -> Result<OwnerConfig, &'static str> {
    if !state_dir.is_absolute() || !state_dir.symlink_metadata().is_ok_and(|meta| meta.is_dir()) {
        return Err("invalid_state_directory");
    }
    let path = state_dir.join("owners.json");
    if !path.symlink_metadata().is_ok_and(|meta| meta.is_file()) {
        return Err("invalid_owner_config");
    }
    let file = File::open(path).map_err(|_| "invalid_owner_config")?;
    let bytes = read_bounded(file, MAX_WIRE_BYTES)?;
    decode(&bytes).map_err(|_| "invalid_owner_config")
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
    let config = config(state_dir)?;
    let bootstrap = bootstrap()?;
    // Opening the registry takes its service lease before mounting any REL.
    let registry =
        Registry::open(config, state_dir, &bootstrap.token).map_err(|error| error.code())?;
    let instance = registry
        .authenticate(&bootstrap.token)
        .map_err(|error| error.code())?;
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
    let service = Arc::new(Service {
        expected_host,
        discovery,
        principal_id: registry.principal_id().to_owned(),
        key,
        registry: Mutex::new(registry),
        sources: Mutex::new(SourceService::open(state_dir)?),
        retrieval: Mutex::new(RetrievalService::open(state_dir)?),
        runtimes: Mutex::new(runtimes),
        closing: AtomicBool::new(false),
        inflight: AtomicUsize::new(0),
        instance,
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
    loop {
        // Expiry is a liveness event, not an idle-time event. Persist fences
        // even while no client is currently talking to the host.
        if let Ok(mut runtimes) = service.runtimes.lock() {
            let _ = runtimes.expire();
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
    drop(sender);
    for worker in workers {
        let _ = worker.join();
    }
    let _ = fs::remove_file(state_dir.join("discovery.json"));
    Ok(())
}
