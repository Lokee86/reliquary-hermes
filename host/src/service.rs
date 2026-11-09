//! One profile-scoped local service and its owner registry.
use crate::{
    registry::{OwnerConfig, Registry, RegistryError},
    service_http::{
        ATTACH, DASHBOARD_TOPOLOGY, FORBIDDEN, HttpError, HttpRequest, HttpResponse, INVALID,
        MAX_WIRE_BYTES, SOURCE, TransportKey, UNAVAILABLE, hex, read_request, write_response,
    },
    service_protocol::{
        AttachRequest, Discovery, HERMES_REVISION, Operation, PROTOCOL_VERSION, ProviderRequest,
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
    registry: Mutex<Registry>,
    sources: Mutex<SourceService>,
    instance: Instance,
}

impl Service {
    fn connection(&self, mut socket: TcpStream, accepted_at: Instant) {
        match read_request(&mut socket, accepted_at, &self.expected_host, &self.key) {
            Ok(request) => {
                let response = self
                    .dispatch(&request)
                    .unwrap_or_else(HttpError::into_response);
                let _ = write_response(&mut socket, response, Some((&self.key, &request.nonce)));
            }
            Err(error) => {
                let _ = write_response(&mut socket, error.into_response(), None);
            }
        }
    }

    fn dispatch(&self, request: &HttpRequest) -> Result<HttpResponse, HttpError> {
        match request.path {
            ATTACH => self.attach(&request.body),
            SOURCE => self.source(&request.body),
            DASHBOARD_TOPOLOGY => self.dashboard_topology(&request.body),
            _ => self.request(&request.body),
        }
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
        self.sources
            .lock()
            .map_err(|_| UNAVAILABLE)?
            .handle(&self.instance, owner, request)
    }

    fn request(&self, bytes: &[u8]) -> Result<HttpResponse, HttpError> {
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
                    request.error("unavailable", "retrieval_unavailable", false)
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
    let service = Arc::new(Service {
        expected_host,
        discovery,
        principal_id: registry.principal_id().to_owned(),
        key,
        registry: Mutex::new(registry),
        sources: Mutex::new(SourceService::open(state_dir)?),
        instance,
    });
    drop(bootstrap);

    let (sender, receiver) = sync_channel::<(TcpStream, Instant)>(QUEUE_CAPACITY);
    let receiver = Arc::new(Mutex::new(receiver));
    for _ in 0..WORKERS {
        let service = Arc::clone(&service);
        let receiver = Arc::clone(&receiver);
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
                }
            })
            .map_err(|_| "worker_unavailable")?;
    }
    publish_discovery(state_dir, &service.discovery)?;
    for connection in listener.incoming() {
        let socket = match connection {
            Ok(socket) => socket,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return Err("loopback_unavailable"),
        };
        match sender.try_send((socket, Instant::now())) {
            Ok(()) => {}
            Err(TrySendError::Full((mut socket, _))) => {
                let _ = write_response(&mut socket, UNAVAILABLE.into_response(), None);
            }
            Err(TrySendError::Disconnected(_)) => return Err("worker_unavailable"),
        }
    }
    Ok(())
}
