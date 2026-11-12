//! Profile-bound, bounded broker between Root and the Hermes Python worker.
use crate::{
    embedding_binding::EmbeddingBinding,
    service_http::{HttpError, HttpResponse, UNAVAILABLE, hex},
    service_protocol::{decode, valid_id},
};
use reliquary_memory::{
    EmbeddingEndpoint, EmbeddingEndpointError, EmbeddingNormalization, GeneralEndpoint,
    GeneralEndpointError, HostedEmbeddingInputSemantics, HostedInferenceIdentity,
    SwitchboardEmbeddingMode,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Arc, Condvar, Mutex},
    time::{Duration, Instant},
};

pub(crate) const IDENTITY: &str = "/v1/inference/identity";
pub(crate) const CLAIM: &str = "/v1/inference/claim";
pub(crate) const REQUEST_PART: &str = "/v1/inference/request-part";
pub(crate) const RESULT_START: &str = "/v1/inference/result-start";
pub(crate) const RESULT_PART: &str = "/v1/inference/result-part";
pub(crate) const CANCEL: &str = "/v1/inference/cancel";
pub(crate) const HEARTBEAT: &str = "/v1/inference/heartbeat";
pub(crate) const WORKER_ERROR: &str = "/v1/inference/worker-error";

const MAX_PENDING: usize = 4;
const MAX_JOB_BYTES: usize = 8 * 1024 * 1024;
const PART_BYTES: usize = 64 * 1024;
const JOB_TIMEOUT: Duration = Duration::from_secs(60);
const WORKER_TTL: Duration = Duration::from_secs(30);
const STALE: HttpError = HttpError::new(409, "inference_stale", false);

#[derive(Clone)]
pub(crate) struct Broker(Arc<Shared>);

struct GeneralAdapter {
    broker: Broker,
    model: String,
    epoch: u64,
}
struct EmbeddingAdapter {
    broker: Broker,
    model: String,
    dimensions: u32,
    normalization: EmbeddingNormalization,
    epoch: u64,
}

struct Shared {
    state: Mutex<State>,
    changed: Condvar,
}

struct State {
    epoch: u64,
    identity: Option<Identity>,
    worker_id: Option<String>,
    heartbeat: Option<Instant>,
    profile_id: Option<String>,
    instance_id: Option<String>,
    service_lease_id: Option<String>,
    worker_error: Option<&'static str>,
    queue: VecDeque<String>,
    jobs: BTreeMap<String, Job>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Identity {
    general_provider: String,
    general_model: String,
    embedding_provider: String,
    embedding_model: String,
    dimensions: u32,
    input_type_handling: String,
    normalization: String,
}

struct Job {
    id: String,
    correlation_id: String,
    operation: &'static str,
    profile_id: String,
    instance_id: String,
    epoch: u64,
    deadline: Instant,
    request: Vec<u8>,
    request_digest: String,
    result: Option<Result<Value, &'static str>>,
    cancelled: bool,
    result_manifest: Option<ResultManifest>,
    result_parts: BTreeMap<usize, Vec<u8>>,
}

#[derive(Clone)]
struct ResultManifest {
    part_count: usize,
    total_bytes: usize,
    digest: String,
    provider: String,
    model: String,
    dimensions: Option<u32>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IdentityRequest {
    worker_id: String,
    profile_id: String,
    instance_id: String,
    service_lease_id: String,
    general: Pair,
    embedding: EmbedIdentity,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Pair {
    provider: String,
    model: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EmbedIdentity {
    provider: String,
    model: String,
    dimensions: u32,
    input_type_handling: String,
    normalization: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ClaimRequest {
    worker_id: String,
    profile_id: String,
    instance_id: String,
    service_lease_id: String,
    wait_ms: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PartRequest {
    worker_id: String,
    job_id: String,
    correlation_id: String,
    lease_epoch: u64,
    part_index: usize,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResultStart {
    worker_id: String,
    job_id: String,
    correlation_id: String,
    lease_epoch: u64,
    status: String,
    provider: Option<String>,
    model: Option<String>,
    dimensions: Option<u32>,
    #[serde(rename = "usage")]
    _usage: Option<Value>,
    error_code: Option<String>,
    part_count: usize,
    total_bytes: usize,
    sha256: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResultPart {
    worker_id: String,
    job_id: String,
    correlation_id: String,
    lease_epoch: u64,
    part_index: usize,
    part_count: usize,
    total_bytes: usize,
    sha256: String,
    data_b64: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct JobRequest {
    worker_id: String,
    job_id: String,
    correlation_id: String,
    lease_epoch: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HeartbeatRequest {
    worker_id: String,
    profile_id: String,
    instance_id: String,
    service_lease_id: String,
    active_job_id: Option<String>,
    lease_epoch: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkerErrorRequest {
    worker_id: String,
    profile_id: String,
    instance_id: String,
    service_lease_id: String,
    error_code: String,
}

impl Broker {
    pub(crate) fn new() -> Self {
        Self(Arc::new(Shared {
            state: Mutex::new(State {
                epoch: 1,
                identity: None,
                worker_id: None,
                heartbeat: None,
                profile_id: None,
                instance_id: None,
                service_lease_id: None,
                worker_error: None,
                queue: VecDeque::new(),
                jobs: BTreeMap::new(),
            }),
            changed: Condvar::new(),
        }))
    }

    pub(crate) fn handle(
        &self,
        path: &str,
        body: &[u8],
        profile: &str,
        instance: &str,
        lease: &str,
    ) -> Result<HttpResponse, HttpError> {
        match path {
            IDENTITY => self.identity(body, profile, instance, lease),
            CLAIM => self.claim(body, profile, instance, lease),
            REQUEST_PART => self.request_part(body),
            RESULT_START => self.result_start(body),
            RESULT_PART => self.result_part(body),
            CANCEL => self.cancel(body),
            HEARTBEAT => self.heartbeat(body, profile, instance, lease),
            WORKER_ERROR => self.worker_error(body, profile, instance, lease),
            _ => Err(crate::service_http::INVALID),
        }
    }

    fn identity(
        &self,
        body: &[u8],
        profile: &str,
        instance: &str,
        lease: &str,
    ) -> Result<HttpResponse, HttpError> {
        let request: IdentityRequest = decode(body).map_err(|_| crate::service_http::INVALID)?;
        if !valid_id(&request.worker_id)
            || request.profile_id != profile
            || request.instance_id != instance
            || request.service_lease_id != lease
            || !safe_identity(&request)
        {
            return Err(crate::service_http::FORBIDDEN);
        }
        let identity = Identity {
            general_provider: request.general.provider,
            general_model: request.general.model,
            embedding_provider: request.embedding.provider,
            embedding_model: request.embedding.model,
            dimensions: request.embedding.dimensions,
            input_type_handling: request.embedding.input_type_handling,
            normalization: request.embedding.normalization,
        };
        let mut state = self.0.state.lock().map_err(|_| UNAVAILABLE)?;
        if state.worker_id.as_deref() == Some(request.worker_id.as_str())
            && state.identity.as_ref() == Some(&identity)
            && state.heartbeat.is_some_and(|at| at.elapsed() <= WORKER_TTL)
        {
            state.heartbeat = Some(Instant::now());
        } else {
            invalidate(&mut state);
            state.epoch = state.epoch.wrapping_add(1).max(1);
            state.identity = Some(identity.clone());
            state.worker_id = Some(request.worker_id);
            state.heartbeat = Some(Instant::now());
        }
        state.profile_id = Some(request.profile_id);
        state.instance_id = Some(request.instance_id);
        state.service_lease_id = Some(request.service_lease_id);
        state.worker_error = None;
        let epoch = state.epoch;
        drop(state);
        self.0.changed.notify_all();
        Ok(HttpResponse::ok(
            json!({"state":"bound","lease_epoch":epoch,"identity":identity_wire(&identity)}),
        ))
    }

    fn claim(
        &self,
        body: &[u8],
        profile: &str,
        instance: &str,
        lease: &str,
    ) -> Result<HttpResponse, HttpError> {
        let request: ClaimRequest = decode(body).map_err(|_| crate::service_http::INVALID)?;
        if request.profile_id != profile
            || request.instance_id != instance
            || request.service_lease_id != lease
            || request.wait_ms > 1000
        {
            return Err(crate::service_http::FORBIDDEN);
        }
        let end = Instant::now() + Duration::from_millis(request.wait_ms);
        let mut state = self.0.state.lock().map_err(|_| UNAVAILABLE)?;
        if !worker_valid(&state, &request.worker_id) {
            return Err(crate::service_http::UNAVAILABLE);
        }
        loop {
            while let Some(id) = state.queue.pop_front() {
                if let Some(job) = state.jobs.get(&id) {
                    if !job.cancelled && job.deadline > Instant::now() && job.epoch == state.epoch {
                        let deadline_ms = job
                            .deadline
                            .saturating_duration_since(Instant::now())
                            .as_millis()
                            .max(1);
                        let result = json!({"state":"claimed","job_id":job.id,"correlation_id":job.correlation_id,"operation":job.operation,"profile_id":job.profile_id,"instance_id":job.instance_id,"lease_epoch":job.epoch,"deadline_ms":deadline_ms,"request":{"part_count":part_count(job.request.len()),"total_bytes":job.request.len(),"sha256":job.request_digest}});
                        return Ok(HttpResponse::ok(result));
                    }
                }
            }
            if request.wait_ms == 0 || Instant::now() >= end {
                return Ok(HttpResponse::ok(json!({"state":"idle"})));
            }
            let wait = end.saturating_duration_since(Instant::now());
            let (next, _) = self
                .0
                .changed
                .wait_timeout(state, wait)
                .map_err(|_| UNAVAILABLE)?;
            state = next;
            if !worker_valid(&state, &request.worker_id) {
                return Err(crate::service_http::UNAVAILABLE);
            }
        }
    }

    fn request_part(&self, body: &[u8]) -> Result<HttpResponse, HttpError> {
        let request: PartRequest = decode(body).map_err(|_| crate::service_http::INVALID)?;
        let state = self.0.state.lock().map_err(|_| UNAVAILABLE)?;
        let job = job_for(
            &state,
            &request.worker_id,
            &request.job_id,
            &request.correlation_id,
            request.lease_epoch,
        )?;
        if request.part_index >= part_count(job.request.len()) {
            return Err(crate::service_http::INVALID);
        }
        let start = request
            .part_index
            .checked_mul(PART_BYTES)
            .ok_or(crate::service_http::INVALID)?;
        let bytes = job
            .request
            .get(start..(start + PART_BYTES).min(job.request.len()))
            .ok_or(crate::service_http::INVALID)?;
        Ok(HttpResponse::ok(
            json!({"job_id":job.id,"correlation_id":job.correlation_id,"lease_epoch":job.epoch,"part_index":request.part_index,"part_count":part_count(job.request.len()),"total_bytes":job.request.len(),"sha256":job.request_digest,"data_b64":b64(bytes)}),
        ))
    }

    fn result_start(&self, body: &[u8]) -> Result<HttpResponse, HttpError> {
        let request: ResultStart = decode(body).map_err(|_| crate::service_http::INVALID)?;
        let mut state = self.0.state.lock().map_err(|_| UNAVAILABLE)?;
        let epoch = state.epoch;
        let identity = state.identity.clone().ok_or(UNAVAILABLE)?;
        let worker = state.worker_id.clone().ok_or(UNAVAILABLE)?;
        let worker_alive = state.heartbeat.is_some_and(|at| at.elapsed() <= WORKER_TTL);
        let job = state.jobs.get(&request.job_id).ok_or(STALE)?;
        if worker != request.worker_id
            || !worker_alive
            || request.lease_epoch != epoch
            || job.epoch != epoch
            || job.correlation_id != request.correlation_id
            || job.cancelled
            || job.deadline <= Instant::now()
        {
            return Err(STALE);
        }
        let operation = job.operation;
        if request.status == "error" {
            let error = match request.error_code.as_deref() {
                Some("inference_timeout") => "inference_timeout",
                Some("inference_invalid_response") => "inference_invalid_response",
                Some("inference_cancelled") => "inference_cancelled",
                Some("inference_stale") => "inference_stale",
                Some("inference_unsupported") => "inference_unsupported",
                Some("embedding_unavailable") => "embedding_unavailable",
                _ => "inference_unavailable",
            };
            state.jobs.get_mut(&request.job_id).ok_or(STALE)?.result = Some(Err(error));
            self.0.changed.notify_all();
            return Ok(HttpResponse::ok(json!({"state":"accepted"})));
        }
        if request.status != "ok"
            || request.part_count == 0
            || request.part_count > MAX_JOB_BYTES.div_ceil(PART_BYTES)
            || request.total_bytes == 0
            || request.total_bytes > MAX_JOB_BYTES
            || request.part_count != part_count(request.total_bytes)
            || request.sha256.len() != 64
        {
            return Err(crate::service_http::INVALID);
        }
        if !matches_identity(
            &identity,
            operation,
            request.provider.as_deref(),
            request.model.as_deref(),
            request.dimensions,
        ) {
            let code = if operation == "embed" {
                "embedding_identity_stale"
            } else {
                "inference_stale"
            };
            invalidate(&mut state);
            state.epoch = state.epoch.wrapping_add(1).max(1);
            state.identity = None;
            state.worker_error = Some(code);
            drop(state);
            self.0.changed.notify_all();
            return Err(STALE);
        }
        let job = state.jobs.get_mut(&request.job_id).ok_or(STALE)?;
        job.result_manifest = Some(ResultManifest {
            part_count: request.part_count,
            total_bytes: request.total_bytes,
            digest: request.sha256,
            provider: request.provider.ok_or(crate::service_http::INVALID)?,
            model: request.model.ok_or(crate::service_http::INVALID)?,
            dimensions: request.dimensions,
        });
        job.result_parts.clear();
        Ok(HttpResponse::ok(json!({"state":"accepted"})))
    }

    fn result_part(&self, body: &[u8]) -> Result<HttpResponse, HttpError> {
        let request: ResultPart = decode(body).map_err(|_| crate::service_http::INVALID)?;
        let mut state = self.0.state.lock().map_err(|_| UNAVAILABLE)?;
        let identity = state.identity.clone().ok_or(STALE)?;
        let worker = state.worker_id.clone().ok_or(UNAVAILABLE)?;
        let epoch = state.epoch;
        let worker_alive = state.heartbeat.is_some_and(|at| at.elapsed() <= WORKER_TTL);
        let mut stale_operation = None;
        {
            let job = state.jobs.get_mut(&request.job_id).ok_or(STALE)?;
            let manifest = job
                .result_manifest
                .clone()
                .ok_or(crate::service_http::INVALID)?;
            if worker != request.worker_id
                || !worker_alive
                || epoch != request.lease_epoch
                || job.epoch != epoch
                || job.correlation_id != request.correlation_id
                || job.cancelled
                || job.result.is_some()
                || job.deadline <= Instant::now()
                || request.part_count != manifest.part_count
                || request.total_bytes != manifest.total_bytes
                || request.sha256 != manifest.digest
                || request.part_index >= manifest.part_count
            {
                return Err(STALE);
            }
            let part = unb64(&request.data_b64).ok_or(crate::service_http::INVALID)?;
            if part.is_empty()
                || part.len() > PART_BYTES
                || (request.part_index + 1 < manifest.part_count && part.len() != PART_BYTES)
                || job.result_parts.insert(request.part_index, part).is_some()
            {
                return Err(crate::service_http::INVALID);
            }
            if job.result_parts.len() == manifest.part_count {
                let mut bytes = Vec::with_capacity(manifest.total_bytes);
                for index in 0..manifest.part_count {
                    bytes.extend_from_slice(
                        job.result_parts
                            .get(&index)
                            .ok_or(crate::service_http::INVALID)?,
                    );
                }
                if bytes.len() != manifest.total_bytes
                    || hex(&Sha256::digest(&bytes)) != manifest.digest
                {
                    job.result = Some(Err("inference_invalid_response"));
                } else {
                    let value =
                        decode::<Value>(&bytes).map_err(|_| crate::service_http::INVALID)?;
                    if response_identity_matches(
                        &identity,
                        job.operation,
                        &manifest.provider,
                        &manifest.model,
                        manifest.dimensions,
                        &value,
                    ) {
                        job.result = Some(Ok(value));
                    } else {
                        job.result = Some(Err("inference_stale"));
                        stale_operation = Some(job.operation);
                    }
                }
            }
        }
        if let Some(operation) = stale_operation {
            invalidate(&mut state);
            state.epoch = state.epoch.wrapping_add(1).max(1);
            state.identity = None;
            state.worker_error = Some(if operation == "embed" {
                "embedding_identity_stale"
            } else {
                "inference_stale"
            });
        }
        self.0.changed.notify_all();
        Ok(HttpResponse::ok(json!({"state":"accepted"})))
    }

    fn cancel(&self, body: &[u8]) -> Result<HttpResponse, HttpError> {
        let request: JobRequest = decode(body).map_err(|_| crate::service_http::INVALID)?;
        let mut state = self.0.state.lock().map_err(|_| UNAVAILABLE)?;
        let job = job_for_mut(
            &mut state,
            &request.worker_id,
            &request.job_id,
            &request.correlation_id,
            request.lease_epoch,
        )?;
        job.cancelled = true;
        if job.result.is_none() {
            job.result = Some(Err("inference_cancelled"));
        }
        self.0.changed.notify_all();
        Ok(HttpResponse::ok(json!({"state":"cancelled"})))
    }

    fn heartbeat(
        &self,
        body: &[u8],
        profile: &str,
        instance: &str,
        lease: &str,
    ) -> Result<HttpResponse, HttpError> {
        let request: HeartbeatRequest = decode(body).map_err(|_| crate::service_http::INVALID)?;
        let mut state = self.0.state.lock().map_err(|_| UNAVAILABLE)?;
        if request.profile_id != profile
            || request.instance_id != instance
            || request.service_lease_id != lease
            || !worker_valid(&state, &request.worker_id)
            || request.lease_epoch != state.epoch
        {
            return Err(crate::service_http::UNAVAILABLE);
        }
        if let Some(id) = request.active_job_id.as_deref() {
            if !state
                .jobs
                .get(id)
                .is_some_and(|job| job.epoch == state.epoch && !job.cancelled)
            {
                return Err(crate::service_http::UNAVAILABLE);
            }
        }
        state.heartbeat = Some(Instant::now());
        Ok(HttpResponse::ok(
            json!({"state":"alive","lease_epoch":state.epoch}),
        ))
    }

    fn worker_error(
        &self,
        body: &[u8],
        profile: &str,
        instance: &str,
        lease: &str,
    ) -> Result<HttpResponse, HttpError> {
        let request: WorkerErrorRequest = decode(body).map_err(|_| crate::service_http::INVALID)?;
        if !valid_id(&request.worker_id)
            || request.profile_id != profile
            || request.instance_id != instance
            || request.service_lease_id != lease
        {
            return Err(crate::service_http::FORBIDDEN);
        }
        let code = match request.error_code.as_str() {
            "embedding_unavailable" => "embedding_unavailable",
            "inference_unavailable" => "inference_unavailable",
            _ => return Err(crate::service_http::INVALID),
        };
        let mut state = self.0.state.lock().map_err(|_| UNAVAILABLE)?;
        invalidate(&mut state);
        state.epoch = state.epoch.wrapping_add(1).max(1);
        state.identity = None;
        state.worker_id = Some(request.worker_id);
        state.profile_id = Some(request.profile_id);
        state.instance_id = Some(request.instance_id);
        state.service_lease_id = Some(request.service_lease_id);
        state.heartbeat = Some(Instant::now());
        state.worker_error = Some(code);
        drop(state);
        self.0.changed.notify_all();
        Ok(HttpResponse::ok(json!({"state":"accepted"})))
    }

    pub(crate) fn unavailable_code(&self) -> Option<&'static str> {
        self.0.state.lock().ok().and_then(|state| {
            state
                .worker_error
                .or_else(|| state.identity.is_none().then_some("embedding_unavailable"))
        })
    }

    pub(crate) fn embedding_binding(&self) -> Result<EmbeddingBinding, &'static str> {
        let state = self
            .0
            .state
            .lock()
            .map_err(|_| "embedding_identity_unavailable")?;
        let identity = state
            .identity
            .as_ref()
            .ok_or(state.worker_error.unwrap_or("embedding_unavailable"))?;
        Ok(EmbeddingBinding {
            provider: identity.embedding_provider.clone(),
            model: identity.embedding_model.clone(),
            dimensions: identity.dimensions,
            input_type_handling: identity.input_type_handling.clone(),
            normalization: identity.normalization.clone(),
        })
    }

    #[cfg(test)]
    fn invoke(&self, operation: &'static str, payload: Value) -> Result<Value, &'static str> {
        self.invoke_bound(operation, payload, Instant::now() + JOB_TIMEOUT, None)
    }

    fn invoke_bound(
        &self,
        operation: &'static str,
        payload: Value,
        deadline: Instant,
        expected_epoch: Option<u64>,
    ) -> Result<Value, &'static str> {
        let bytes = serde_json::to_vec(&payload).map_err(|_| "inference_invalid_response")?;
        if bytes.len() > MAX_JOB_BYTES {
            return Err("inference_invalid_response");
        }
        let id = opaque_id().ok_or("inference_unavailable")?;
        let correlation = opaque_id().ok_or("inference_unavailable")?;
        if deadline <= Instant::now() {
            return Err("inference_timeout");
        }
        let mut state = self.0.state.lock().map_err(|_| "inference_unavailable")?;
        state.identity.as_ref().ok_or("inference_unavailable")?;
        if expected_epoch.is_some_and(|expected| expected != state.epoch) {
            return Err("inference_stale");
        }
        if state.heartbeat.is_none_or(|at| at.elapsed() > WORKER_TTL) || state.worker_id.is_none() {
            return Err("inference_unavailable");
        }
        if state
            .jobs
            .values()
            .filter(|job| job.result.is_none() && !job.cancelled)
            .count()
            >= MAX_PENDING
        {
            return Err("inference_backpressure");
        }
        let epoch = state.epoch;
        let profile_id = state.profile_id.clone().ok_or("inference_unavailable")?;
        let instance_id = state.instance_id.clone().ok_or("inference_unavailable")?;
        let mut job = Job {
            id: id.clone(),
            correlation_id: correlation,
            operation,
            profile_id,
            instance_id,
            epoch,
            deadline,
            request: bytes,
            request_digest: String::new(),
            result: None,
            cancelled: false,
            result_manifest: None,
            result_parts: BTreeMap::new(),
        };
        job.request_digest = hex(&Sha256::digest(&job.request));
        state.queue.push_back(id.clone());
        state.jobs.insert(id.clone(), job);
        self.0.changed.notify_all();
        loop {
            if state.heartbeat.is_none_or(|at| at.elapsed() > WORKER_TTL) {
                state.jobs.remove(&id);
                return Err("inference_unavailable");
            }
            if let Some(job) = state.jobs.get(&id) {
                if let Some(result) = job.result.as_ref() {
                    let result = result.clone();
                    state.jobs.remove(&id);
                    return result;
                }
                if job.epoch != state.epoch || job.deadline <= Instant::now() {
                    if let Some(job) = state.jobs.get_mut(&id) {
                        job.cancelled = true;
                    }
                    state.jobs.remove(&id);
                    return Err("inference_timeout");
                }
            } else {
                return Err("inference_stale");
            }
            let job_wait = state
                .jobs
                .get(&id)
                .map(|job| job.deadline.saturating_duration_since(Instant::now()))
                .unwrap_or_default();
            let worker_wait = state
                .heartbeat
                .map(|at| (at + WORKER_TTL).saturating_duration_since(Instant::now()))
                .unwrap_or_default();
            let wait = job_wait.min(worker_wait);
            let (next, _) = self
                .0
                .changed
                .wait_timeout(state, wait)
                .map_err(|_| "inference_unavailable")?;
            state = next;
        }
    }

    pub(crate) fn bind_runtime(
        &self,
    ) -> Result<Arc<reliquary_memory::ConfiguredRuntime>, &'static str> {
        let (request, epoch) = {
            let state = self.0.state.lock().map_err(|_| "inference_unavailable")?;
            (
                state.identity.clone().ok_or("inference_unavailable")?,
                state.epoch,
            )
        };
        let hosted_identity = hosted_identity(&request)?;
        let general: Arc<dyn GeneralEndpoint> = Arc::new(GeneralAdapter {
            broker: self.clone(),
            model: request.general_model.clone(),
            epoch,
        });
        let embedding: Arc<dyn EmbeddingEndpoint> = Arc::new(EmbeddingAdapter {
            broker: self.clone(),
            model: request.embedding_model.clone(),
            dimensions: request.dimensions,
            normalization: if request.normalization == "l2" {
                EmbeddingNormalization::L2
            } else {
                EmbeddingNormalization::None
            },
            epoch,
        });
        let runtime =
            reliquary_memory::ConfiguredRuntime::hosted(general, embedding, hosted_identity)
                .map_err(|_| "inference_invalid_response")?;
        let state = self.0.state.lock().map_err(|_| "inference_unavailable")?;
        if state.identity.as_ref() != Some(&request) || state.epoch != epoch {
            return Err("inference_stale");
        }
        Ok(Arc::new(runtime))
    }
}

impl GeneralEndpoint for GeneralAdapter {
    fn model(&self) -> &str {
        &self.model
    }
    fn complete_json(
        &self,
        system_prompt: &str,
        user_payload: &str,
        schema_name: &str,
        schema: &Value,
    ) -> Result<Value, GeneralEndpointError> {
        let payload = json!({"instructions":system_prompt,"input":[{"type":"text","text":user_payload}],"json_schema":schema,"schema_name":schema_name,"purpose":"general"});
        let value = self
            .broker
            .invoke_bound(
                "complete_structured",
                payload,
                Instant::now() + JOB_TIMEOUT,
                Some(self.epoch),
            )
            .map_err(general_error)?;
        value
            .get("parsed")
            .cloned()
            .ok_or(GeneralEndpointError::InvalidResponse(
                "hosted_structured_result",
            ))
    }
}

impl EmbeddingEndpoint for EmbeddingAdapter {
    fn model(&self) -> Option<&str> {
        Some(&self.model)
    }
    fn dimensions(&self) -> u32 {
        self.dimensions
    }
    fn normalization(&self) -> EmbeddingNormalization {
        self.normalization
    }
    fn supports_bounded_embedding(&self) -> bool {
        true
    }
    fn embed_bounded(
        &self,
        mode: SwitchboardEmbeddingMode,
        inputs: &[String],
        max_response_bytes: usize,
    ) -> Result<Vec<Vec<f32>>, EmbeddingEndpointError> {
        self.embed_with_limit(mode, inputs, max_response_bytes)
    }
    fn embed(
        &self,
        mode: SwitchboardEmbeddingMode,
        inputs: &[String],
    ) -> Result<Vec<Vec<f32>>, EmbeddingEndpointError> {
        self.embed_with_limit(mode, inputs, MAX_JOB_BYTES)
    }
}

impl EmbeddingAdapter {
    fn embed_with_limit(
        &self,
        mode: SwitchboardEmbeddingMode,
        inputs: &[String],
        max_response_bytes: usize,
    ) -> Result<Vec<Vec<f32>>, EmbeddingEndpointError> {
        let input_type = match mode {
            SwitchboardEmbeddingMode::Query => "query",
            SwitchboardEmbeddingMode::Document => "document",
        };
        let mut rows = Vec::new();
        let mut batch: Vec<&str> = Vec::new();
        let deadline = Instant::now() + JOB_TIMEOUT;
        for input in inputs {
            let mut candidate = batch.clone();
            candidate.push(input);
            let payload = embedding_payload(&candidate, input_type, self.dimensions);
            let request_bytes = serde_json::to_vec(&payload)
                .map_err(|_| EmbeddingEndpointError::InvalidResponse("hosted_embedding_request"))?;
            if !batch.is_empty()
                && (request_bytes.len() > MAX_JOB_BYTES
                    || response_estimate(candidate.len(), self.dimensions) > max_response_bytes)
            {
                append_embedding_batch(
                    &self.broker,
                    &batch,
                    input_type,
                    self.dimensions,
                    deadline,
                    self.epoch,
                    max_response_bytes,
                    &mut rows,
                )?;
                batch.clear();
                batch.push(input);
                let single = embedding_payload(&batch, input_type, self.dimensions);
                if serde_json::to_vec(&single).map_or(true, |bytes| bytes.len() > MAX_JOB_BYTES)
                    || response_estimate(1, self.dimensions) > max_response_bytes
                {
                    return Err(EmbeddingEndpointError::InvalidResponse(
                        "hosted_embedding_result_too_large",
                    ));
                }
            } else {
                batch.push(input);
                if request_bytes.len() > MAX_JOB_BYTES
                    || response_estimate(batch.len(), self.dimensions) > max_response_bytes
                {
                    return Err(EmbeddingEndpointError::InvalidResponse(
                        "hosted_embedding_result_too_large",
                    ));
                }
            }
        }
        append_embedding_batch(
            &self.broker,
            &batch,
            input_type,
            self.dimensions,
            deadline,
            self.epoch,
            max_response_bytes,
            &mut rows,
        )?;
        if rows.len() != inputs.len() {
            return Err(EmbeddingEndpointError::InvalidResponse(
                "hosted_embedding_result_count",
            ));
        }
        if serde_json::to_vec(&rows).map_or(true, |bytes| bytes.len() > max_response_bytes) {
            return Err(EmbeddingEndpointError::InvalidResponse(
                "hosted_embedding_result_too_large",
            ));
        }
        Ok(rows)
    }
}

fn embedding_payload(inputs: &[&str], input_type: &str, dimensions: u32) -> Value {
    json!({"inputs":inputs,"input_type":input_type,"dimensions":dimensions,"purpose":"retrieval"})
}

fn response_estimate(count: usize, dimensions: u32) -> usize {
    count
        .saturating_mul(dimensions as usize)
        .saturating_mul(24)
        .saturating_add(count.saturating_mul(2))
        .saturating_add(1024)
}

fn append_embedding_batch(
    broker: &Broker,
    inputs: &[&str],
    input_type: &str,
    dimensions: u32,
    deadline: Instant,
    epoch: u64,
    max_response_bytes: usize,
    output: &mut Vec<Vec<f32>>,
) -> Result<(), EmbeddingEndpointError> {
    if inputs.is_empty() {
        return Ok(());
    }
    let value = broker
        .invoke_bound(
            "embed",
            embedding_payload(inputs, input_type, dimensions),
            deadline,
            Some(epoch),
        )
        .map_err(embedding_error)?;
    if serde_json::to_vec(&value).map_or(true, |bytes| bytes.len() > max_response_bytes) {
        return Err(EmbeddingEndpointError::InvalidResponse(
            "hosted_embedding_result_too_large",
        ));
    }
    let vectors = serde_json::from_value::<Vec<Vec<f32>>>(value.get("vectors").cloned().ok_or(
        EmbeddingEndpointError::InvalidResponse("hosted_embedding_result"),
    )?)
    .map_err(|_| EmbeddingEndpointError::InvalidResponse("hosted_embedding_result"))?;
    if vectors.len() != inputs.len()
        || vectors
            .iter()
            .any(|vector| vector.len() != dimensions as usize)
    {
        return Err(EmbeddingEndpointError::InvalidResponse(
            "hosted_embedding_result_dimensions",
        ));
    }
    output.extend(vectors);
    Ok(())
}

fn safe_identity(request: &IdentityRequest) -> bool {
    [
        &request.general.provider,
        &request.general.model,
        &request.embedding.provider,
        &request.embedding.model,
    ]
    .iter()
    .all(|value| !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control))
        && (1..=65536).contains(&request.embedding.dimensions)
        && request.embedding.input_type_handling == "shared"
        && matches!(request.embedding.normalization.as_str(), "l2" | "none")
}
fn hosted_identity(identity: &Identity) -> Result<HostedInferenceIdentity, &'static str> {
    HostedInferenceIdentity::new(
        identity.general_provider.clone(),
        identity.general_model.clone(),
        identity.embedding_provider.clone(),
        identity.embedding_model.clone(),
        identity.dimensions,
        HostedEmbeddingInputSemantics::Shared,
        if identity.normalization == "l2" {
            EmbeddingNormalization::L2
        } else {
            EmbeddingNormalization::None
        },
    )
    .map_err(|_| "inference_invalid_response")
}
fn identity_wire(identity: &Identity) -> Value {
    json!({"general":{"provider":identity.general_provider,"model":identity.general_model},"embedding":{"provider":identity.embedding_provider,"model":identity.embedding_model,"dimensions":identity.dimensions,"input_type_handling":identity.input_type_handling,"normalization":identity.normalization}})
}
fn matches_identity(
    identity: &Identity,
    operation: &str,
    provider: Option<&str>,
    model: Option<&str>,
    dimensions: Option<u32>,
) -> bool {
    if operation == "embed" {
        provider == Some(identity.embedding_provider.as_str())
            && model == Some(identity.embedding_model.as_str())
            && dimensions == Some(identity.dimensions)
    } else {
        provider == Some(identity.general_provider.as_str())
            && model == Some(identity.general_model.as_str())
            && dimensions.is_none()
    }
}

fn response_identity_matches(
    identity: &Identity,
    operation: &str,
    provider: &str,
    model: &str,
    dimensions: Option<u32>,
    response: &Value,
) -> bool {
    if !matches_identity(identity, operation, Some(provider), Some(model), dimensions)
        || response["provider"].as_str() != Some(provider)
        || response["model"].as_str() != Some(model)
    {
        return false;
    }
    if operation == "embed" {
        response["dimensions"].as_u64() == dimensions.map(u64::from)
    } else {
        response.get("dimensions").is_none_or(Value::is_null)
    }
}
fn worker_valid(state: &State, worker: &str) -> bool {
    state.worker_id.as_deref() == Some(worker)
        && state.identity.is_some()
        && state.heartbeat.is_some_and(|at| at.elapsed() <= WORKER_TTL)
}
fn job_for<'a>(
    state: &'a State,
    worker: &str,
    id: &str,
    correlation: &str,
    epoch: u64,
) -> Result<&'a Job, HttpError> {
    if !worker_valid(state, worker) || epoch != state.epoch {
        return Err(STALE);
    }
    let job = state.jobs.get(id).ok_or(STALE)?;
    if job.correlation_id != correlation
        || job.epoch != epoch
        || job.cancelled
        || job.deadline <= Instant::now()
    {
        Err(STALE)
    } else {
        Ok(job)
    }
}
fn job_for_mut<'a>(
    state: &'a mut State,
    worker: &str,
    id: &str,
    correlation: &str,
    epoch: u64,
) -> Result<&'a mut Job, HttpError> {
    if state.worker_id.as_deref() != Some(worker) || epoch != state.epoch {
        return Err(STALE);
    }
    let job = state.jobs.get_mut(id).ok_or(STALE)?;
    if job.correlation_id != correlation || job.epoch != epoch || job.deadline <= Instant::now() {
        Err(STALE)
    } else {
        Ok(job)
    }
}
fn invalidate(state: &mut State) {
    state.queue.clear();
    for job in state.jobs.values_mut() {
        job.cancelled = true;
        job.result = Some(Err("inference_stale"));
    }
}
fn part_count(length: usize) -> usize {
    length.div_ceil(PART_BYTES)
}
fn opaque_id() -> Option<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).ok()?;
    Some(hex(&bytes))
}
fn general_error(code: &'static str) -> GeneralEndpointError {
    match code {
        "inference_invalid_response" => GeneralEndpointError::InvalidResponse("hosted_response"),
        "inference_backpressure" => GeneralEndpointError::Backpressure {
            message: "hosted inference queue is full".into(),
            retry_after: Some(Duration::from_secs(1)),
        },
        _ => GeneralEndpointError::Failure(code.into()),
    }
}
fn embedding_error(code: &'static str) -> EmbeddingEndpointError {
    match code {
        "inference_invalid_response" => EmbeddingEndpointError::InvalidResponse("hosted_response"),
        _ => EmbeddingEndpointError::Failure(code.into()),
    }
}
fn b64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        out.push(char::from(T[((n >> 18) & 63) as usize]));
        out.push(char::from(T[((n >> 12) & 63) as usize]));
        out.push(if chunk.len() > 1 {
            char::from(T[((n >> 6) & 63) as usize])
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            char::from(T[(n & 63) as usize])
        } else {
            '='
        });
    }
    out
}
fn unb64(value: &str) -> Option<Vec<u8>> {
    if value.len() % 4 != 0 || value.len() > ((PART_BYTES + 2) / 3) * 4 {
        return None;
    }
    let mut out = Vec::with_capacity(value.len() / 4 * 3);
    for (index, c) in value.as_bytes().chunks_exact(4).enumerate() {
        let last = index + 1 == value.len() / 4;
        if (c[2] == b'=' && (!last || c[3] != b'=')) || (c[3] == b'=' && !last) {
            return None;
        }
        let a = decode64(c[0])?;
        let b = decode64(c[1])?;
        let c2 = if c[2] == b'=' { 0 } else { decode64(c[2])? };
        let d = if c[3] == b'=' { 0 } else { decode64(c[3])? };
        let n = (u32::from(a) << 18) | (u32::from(b) << 12) | (u32::from(c2) << 6) | u32::from(d);
        out.push((n >> 16) as u8);
        if c[2] != b'=' {
            out.push((n >> 8) as u8);
        }
        if c[3] != b'=' {
            out.push(n as u8);
        }
    }
    if b64(&out) != value {
        return None;
    }
    Some(out)
}
fn decode64(b: u8) -> Option<u8> {
    match b {
        b'A'..=b'Z' => Some(b - b'A'),
        b'a'..=b'z' => Some(b - b'a' + 26),
        b'0'..=b'9' => Some(b - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service_http::ResponseBody;
    use std::{thread, time::Duration};

    const PROFILE: &str = "profile-one";
    const INSTANCE: &str = "instance-one";
    const LEASE: &str = "lease-one";

    fn identity_body(worker_id: &str, general_model: &str) -> Value {
        json!({
            "worker_id": worker_id,
            "profile_id": PROFILE,
            "instance_id": INSTANCE,
            "service_lease_id": LEASE,
            "general": {"provider":"openai-api", "model":general_model},
            "embedding": {"provider":"openai-api", "model":"text-embedding-3-small", "dimensions":3, "input_type_handling":"shared", "normalization":"none"}
        })
    }

    fn value(response: HttpResponse) -> Value {
        match response.body {
            ResponseBody::Json { value, .. } => value,
            ResponseBody::Binary(_) => panic!("expected JSON"),
        }
    }

    fn post(broker: &Broker, path: &str, body: Value) -> Result<Value, HttpError> {
        broker
            .handle(
                path,
                &serde_json::to_vec(&body).unwrap(),
                PROFILE,
                INSTANCE,
                LEASE,
            )
            .map(value)
    }

    fn bind(broker: &Broker, worker: &str, model: &str) -> u64 {
        bind_with_dimensions(broker, worker, model, 3)
    }

    fn bind_with_dimensions(broker: &Broker, worker: &str, model: &str, dimensions: u32) -> u64 {
        let mut request = identity_body(worker, model);
        request["embedding"]["dimensions"] = json!(dimensions);
        let response = post(broker, IDENTITY, request).unwrap();
        assert_eq!(response["state"], "bound");
        response["lease_epoch"].as_u64().unwrap()
    }

    fn claim(broker: &Broker) -> Value {
        let end = Instant::now() + Duration::from_secs(2);
        loop {
            let response = post(
                broker,
                CLAIM,
                json!({"worker_id":"worker-one", "profile_id":PROFILE, "instance_id":INSTANCE, "service_lease_id":LEASE, "wait_ms":20}),
            )
            .unwrap();
            if response["state"] == "claimed" {
                return response;
            }
            assert!(Instant::now() < end, "worker did not receive a queued job");
            thread::sleep(Duration::from_millis(5));
        }
    }

    fn read_request_bytes(broker: &Broker, claim: &Value) -> Vec<u8> {
        let mut bytes = Vec::new();
        let count = claim["request"]["part_count"].as_u64().unwrap() as usize;
        for index in 0..count {
            let part = post(
                broker,
                REQUEST_PART,
                json!({"worker_id":"worker-one", "job_id":claim["job_id"], "correlation_id":claim["correlation_id"], "lease_epoch":claim["lease_epoch"], "part_index":index}),
            )
            .unwrap();
            assert_eq!(part["sha256"], claim["request"]["sha256"]);
            assert_eq!(part["part_count"], count);
            bytes.extend(unb64(part["data_b64"].as_str().unwrap()).unwrap());
        }
        assert_eq!(
            bytes.len(),
            claim["request"]["total_bytes"].as_u64().unwrap() as usize
        );
        assert_eq!(hex(&Sha256::digest(&bytes)), claim["request"]["sha256"]);
        bytes
    }

    fn finish(broker: &Broker, claim: &Value, mut actual: Value, tamper: bool) {
        let job = claim["job_id"].as_str().unwrap();
        let correlation = claim["correlation_id"].as_str().unwrap();
        let epoch = claim["lease_epoch"].as_u64().unwrap();
        let operation = claim["operation"].as_str().unwrap();
        let (provider, model, dimensions): (String, String, Option<u32>) = if operation == "embed" {
            (
                actual["provider"]
                    .as_str()
                    .unwrap_or("openai-api")
                    .to_owned(),
                actual["model"]
                    .as_str()
                    .unwrap_or("text-embedding-3-small")
                    .to_owned(),
                actual["dimensions"].as_u64().map(|value| value as u32),
            )
        } else {
            ("openai-api".to_owned(), "gpt-test".to_owned(), None)
        };
        if operation != "embed" {
            actual["provider"] = json!(provider.clone());
            actual["model"] = json!(model.clone());
        }
        let bytes = serde_json::to_vec(&actual).unwrap();
        let digest = hex(&Sha256::digest(&bytes));
        let response = post(
            broker,
            RESULT_START,
            json!({"worker_id":"worker-one", "job_id":job, "correlation_id":correlation, "lease_epoch":epoch, "status":"ok", "provider":provider, "model":model, "dimensions":dimensions, "usage":null, "error_code":null, "part_count":part_count(bytes.len()), "total_bytes":bytes.len(), "sha256":digest}),
        )
        .unwrap();
        assert_eq!(response["state"], "accepted");
        let outgoing = if tamper {
            let mut changed = bytes.clone();
            let index = changed.len().saturating_sub(2);
            changed[index] = if changed[index] == b'1' { b'2' } else { b'1' };
            changed
        } else {
            bytes
        };
        for (index, part) in outgoing.chunks(PART_BYTES).enumerate() {
            post(
                broker,
                RESULT_PART,
                json!({"worker_id":"worker-one", "job_id":job, "correlation_id":correlation, "lease_epoch":epoch, "part_index":index, "part_count":part_count(outgoing.len()), "total_bytes":outgoing.len(), "sha256":digest, "data_b64":b64(part)}),
            )
            .unwrap();
        }
    }

    #[test]
    fn two_parallel_jobs_roundtrip_through_bounded_parts() {
        let broker = Broker::new();
        bind(&broker, "worker-one", "gpt-test");
        let mut calls = Vec::new();
        for index in 0..2 {
            let broker = broker.clone();
            calls.push(thread::spawn(move || {
                broker.invoke(
                    "complete_structured",
                    json!({"input":[{"type":"text","text":index.to_string()}]}),
                )
            }));
        }
        let first = claim(&broker);
        let second = claim(&broker);
        assert!(!read_request_bytes(&broker, &first).is_empty());
        assert!(!read_request_bytes(&broker, &second).is_empty());
        finish(&broker, &first, json!({"parsed":{"ok":true}}), false);
        finish(&broker, &second, json!({"parsed":{"ok":true}}), false);
        for call in calls {
            assert_eq!(call.join().unwrap().unwrap()["parsed"]["ok"], true);
        }
    }

    #[test]
    fn request_is_reassembled_from_bounded_parts_with_manifest_verification() {
        let broker = Broker::new();
        bind(&broker, "worker-one", "gpt-test");
        let payload = "x".repeat(PART_BYTES + 17);
        let call_broker = broker.clone();
        let call = thread::spawn(move || {
            call_broker.invoke("complete_structured", json!({"input":payload}))
        });
        let claimed = claim(&broker);
        assert_eq!(claimed["request"]["part_count"], 2);
        let huge_index = usize::MAX / PART_BYTES;
        assert!(post(
            &broker,
            REQUEST_PART,
            json!({"worker_id":"worker-one", "job_id":claimed["job_id"], "correlation_id":claimed["correlation_id"], "lease_epoch":claimed["lease_epoch"], "part_index":huge_index}),
        )
        .is_err());
        let reassembled = read_request_bytes(&broker, &claimed);
        let request: Value = serde_json::from_slice(&reassembled).unwrap();
        assert_eq!(request["input"].as_str().unwrap().len(), PART_BYTES + 17);
        finish(&broker, &claimed, json!({"parsed":{"ok":true}}), false);
        assert!(call.join().unwrap().is_ok());
    }

    #[test]
    fn embedding_result_larger_than_http_frame_is_reassembled_before_root_validation() {
        let broker = Broker::new();
        let epoch = bind_with_dimensions(&broker, "worker-one", "gpt-test", 512);
        let endpoint = EmbeddingAdapter {
            broker: broker.clone(),
            model: "text-embedding-3-small".into(),
            dimensions: 512,
            normalization: EmbeddingNormalization::None,
            epoch,
        };
        let inputs = vec!["sample".to_owned(); 30];
        let embed = thread::spawn(move || endpoint.embed(SwitchboardEmbeddingMode::Query, &inputs));
        let claimed = claim(&broker);
        assert_eq!(claimed["operation"], "embed");
        let rows = vec![vec![0.12345679_f32; 512]; 30];
        let actual = json!({"vectors":rows,"provider":"openai-api","model":"text-embedding-3-small","dimensions":512,"usage":null});
        assert!(serde_json::to_vec(&actual).unwrap().len() > 256 * 1024);
        finish(&broker, &claimed, actual, false);
        let vectors = embed.join().unwrap().unwrap();
        assert_eq!(vectors.len(), 30);
        assert!(vectors.iter().all(|row| row.len() == 512));
    }

    #[test]
    fn stale_worker_epoch_cannot_complete_inflight_job() {
        let broker = Broker::new();
        let old_epoch = bind(&broker, "worker-one", "gpt-test");
        let call_broker = broker.clone();
        let call =
            thread::spawn(move || call_broker.invoke("complete_structured", json!({"input":[]})));
        let claimed = claim(&broker);
        assert_eq!(claimed["lease_epoch"], old_epoch);
        let new_epoch = bind(&broker, "worker-two", "gpt-next");
        assert_ne!(new_epoch, old_epoch);
        let late = post(
            &broker,
            RESULT_START,
            json!({"worker_id":"worker-one", "job_id":claimed["job_id"], "correlation_id":claimed["correlation_id"], "lease_epoch":old_epoch, "status":"ok", "provider":"openai-api", "model":"gpt-test", "dimensions":null, "usage":null, "error_code":null, "part_count":1, "total_bytes":2, "sha256":"0000000000000000000000000000000000000000000000000000000000000000"}),
        );
        assert!(late.is_err());
        assert_eq!(call.join().unwrap(), Err("inference_stale"));
    }

    #[test]
    fn per_call_model_change_invalidates_every_job_before_result_parts() {
        let broker = Broker::new();
        let epoch = bind(&broker, "worker-one", "gpt-test");
        let call_broker = broker.clone();
        let call = thread::spawn(move || call_broker.invoke("embed", json!({"inputs":["x"]})));
        let claimed = claim(&broker);
        let error = post(
            &broker,
            RESULT_START,
            json!({"worker_id":"worker-one", "job_id":claimed["job_id"], "correlation_id":claimed["correlation_id"], "lease_epoch":epoch, "status":"ok", "provider":"openai-api", "model":"text-embedding-3-large", "dimensions":3, "usage":null, "error_code":null, "part_count":1, "total_bytes":2, "sha256":"0000000000000000000000000000000000000000000000000000000000000000"}),
        )
        .unwrap_err();
        assert_eq!(error.status_code(), 409);
        assert_eq!(error.code(), "inference_stale");
        assert_eq!(call.join().unwrap(), Err("inference_stale"));
        assert_eq!(broker.unavailable_code(), Some("embedding_identity_stale"));
    }

    #[test]
    fn result_digest_mismatch_fails_closed() {
        let broker = Broker::new();
        bind(&broker, "worker-one", "gpt-test");
        let call_broker = broker.clone();
        let call =
            thread::spawn(move || call_broker.invoke("complete_structured", json!({"input":[]})));
        let claimed = claim(&broker);
        finish(&broker, &claimed, json!({"parsed":{"safe":true}}), true);
        assert_eq!(call.join().unwrap(), Err("inference_invalid_response"));
    }

    #[test]
    fn worker_capability_failure_is_profile_bound_and_visible() {
        let broker = Broker::new();
        let response = post(&broker, WORKER_ERROR, json!({"worker_id":"worker-one", "profile_id":PROFILE, "instance_id":INSTANCE, "service_lease_id":LEASE, "error_code":"embedding_unavailable"})).unwrap();
        assert_eq!(response["state"], "accepted");
        assert_eq!(broker.unavailable_code(), Some("embedding_unavailable"));
        let denied = broker.handle(WORKER_ERROR, br#"{"worker_id":"worker-one","profile_id":"other","instance_id":"instance-one","service_lease_id":"lease-one","error_code":"embedding_unavailable"}"#, PROFILE, INSTANCE, LEASE);
        assert!(denied.is_err());
    }

    #[test]
    fn unknown_input_semantics_cannot_bind() {
        let broker = Broker::new();
        let mut body = identity_body("worker-one", "gpt-test");
        body["embedding"]["input_type_handling"] = json!("prefix-dependent");
        assert!(post(&broker, IDENTITY, body).is_err());
        assert_eq!(broker.unavailable_code(), Some("embedding_unavailable"));
    }

    #[test]
    fn generation_model_changes_do_not_change_embedding_binding() {
        let broker = Broker::new();
        bind(&broker, "worker-one", "gpt-one");
        let before = broker.embedding_binding().unwrap();
        let response = post(&broker, IDENTITY, identity_body("worker-one", "gpt-two")).unwrap();
        assert_eq!(response["state"], "bound");
        assert_eq!(broker.embedding_binding().unwrap(), before);
    }
}
