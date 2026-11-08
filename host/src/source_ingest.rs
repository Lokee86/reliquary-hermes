//! Map authenticated source work to the native Root import and maintenance flows.
use crate::{
    service_http::{HttpError, HttpResponse, INVALID, UNAVAILABLE, hex},
    source_store::{SourceHead, SourceState, SourceStore},
    source_wire::{Evidence, Snapshot, SourceAction, SourceRequest},
};
use reliquary_memory::{
    ConfiguredRuntime, HermesCopiedSnapshot, HermesCopyScope, Instance, NativeImportPlan,
    NativeImportState, OwnerId, OwnerProcessingJob, ProcessOptions,
};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs::File, io::Read, path::Path};

const STALE: HttpError = HttpError::new(409, "source_generation_stale", false);
const UNRECONCILED: HttpError = HttpError::new(409, "source_revision_unreconciled", false);
const TERMINAL: HttpError = HttpError::new(409, "source_terminal", false);
const PENDING: HttpError = HttpError::new(503, "source_import_pending", true);

pub(crate) struct SourceService {
    store: SourceStore,
    runtime: Option<ConfiguredRuntime>,
    jobs: BTreeMap<OwnerId, OwnerProcessingJob>,
}

impl SourceService {
    pub(crate) fn open(state_dir: &Path) -> Result<Self, &'static str> {
        Ok(Self {
            store: SourceStore::open(state_dir)?,
            runtime: configured_runtime(state_dir)?,
            jobs: BTreeMap::new(),
        })
    }

    pub(crate) fn handle(
        &mut self,
        instance: &Instance,
        owner: OwnerId,
        request: SourceRequest,
    ) -> Result<HttpResponse, HttpError> {
        let snapshot = if request.operation == SourceAction::Snapshot {
            Some(Snapshot::parse(&request)?)
        } else {
            None
        };
        verify_key(
            &request,
            snapshot.as_ref().map(|snapshot| snapshot.digest.as_str()),
        )?;
        let path = self.store.path(&request.session_id);
        let mut state = self.store.read(&path)?;
        if request.operation == SourceAction::Terminal {
            if !state.terminal || request.generation > state.generation {
                state.generation = state.generation.max(request.generation);
                state.terminal = true;
                state.available = false;
                self.store.write(&path, &state)?;
            }
            self.tombstone(instance, owner, &request, &mut state, &path)?;
            return Ok(receipt(&request, request.idempotency_key.clone()));
        }
        if state.terminal {
            return Err(TERMINAL);
        }
        if request.operation == SourceAction::Invalidate {
            if request.generation < state.generation || request.generation == 0 {
                return Err(STALE);
            }
            if request.generation > state.generation {
                state.generation = request.generation;
                state.available = false;
                state.stale = true;
                self.store.write(&path, &state)?;
            }
            return Ok(receipt(&request, request.idempotency_key.clone()));
        }
        if request.generation != state.generation {
            return Err(STALE);
        }
        if state.stale {
            return Err(UNRECONCILED);
        }
        self.submit(
            instance,
            owner,
            &request,
            snapshot.ok_or(INVALID)?,
            &path,
            state,
        )
    }

    fn submit(
        &mut self,
        instance: &Instance,
        owner: OwnerId,
        request: &SourceRequest,
        snapshot: Snapshot,
        path: &Path,
        mut state: SourceState,
    ) -> Result<HttpResponse, HttpError> {
        if state.pending.is_some() {
            self.recover_pending(instance, owner, &mut state, path)?;
            if state
                .pending
                .as_ref()
                .is_some_and(|head| head.request_key != request.idempotency_key)
            {
                return Err(PENDING);
            }
            if state.pending.is_none() {
                self.store.write(path, &state)?;
            }
        }
        if let Some(evidence) = self.store.read_receipt(path, &request.idempotency_key)? {
            if let Some(accepted) = &state.accepted {
                self.schedule(instance, owner, &accepted.import_id);
            }
            return Ok(receipt(request, hex(&evidence)));
        }
        let skip = if let Some(accepted) = &state.accepted {
            let overlap = overlap(accepted, &snapshot);
            let Some(skip) = overlap else {
                state.available = false;
                state.stale = true;
                self.store.write(path, &state)?;
                return Err(UNRECONCILED);
            };
            if accepted.wire_digest == snapshot.digest || skip == snapshot.messages.len() {
                let evidence = accepted.receipt.ok_or(UNAVAILABLE)?;
                self.store
                    .write_receipt(path, &request.idempotency_key, evidence)?;
                self.schedule(instance, owner, &accepted.import_id);
                return Ok(receipt(request, hex(&evidence)));
            }
            let status = instance
                .native_import_status(owner, &accepted.import_id)
                .map_err(|_| UNAVAILABLE)?;
            if !status.is_some_and(|status| status.state == NativeImportState::Completed) {
                self.schedule(instance, owner, &accepted.import_id);
                return Err(PENDING);
            }
            skip
        } else {
            0
        };
        // Root can expose a completed receipt just before its worker returns.
        // Wait for that job to exit before opening another epoch on this owner.
        if self.jobs.get(&owner).is_some_and(|job| !job.is_finished()) {
            return Err(PENDING);
        }
        let native = HermesCopiedSnapshot {
            scope: scope(request)?,
            branch_id: snapshot.branch.clone(),
            source_revision: snapshot.revision,
            messages: snapshot.messages.into_iter().skip(skip).collect(),
        };
        let plan = match &state.accepted {
            Some(accepted) => {
                NativeImportPlan::from_hermes_copy_extension(native, accepted.native_digest)
            }
            None => NativeImportPlan::from_hermes_copy(native),
        }
        .map_err(|_| INVALID)?;
        let mut candidate = SourceHead {
            wire_digest: snapshot.digest,
            request_key: request.idempotency_key.clone(),
            native_digest: plan.source_sha256(),
            import_id: plan.import_id(owner),
            branch: snapshot.branch,
            evidence: snapshot.evidence,
            receipt: None,
        };
        if state
            .pending
            .as_ref()
            .is_some_and(|head| head.native_digest != candidate.native_digest)
        {
            return Err(UNAVAILABLE);
        }
        state.pending = Some(candidate.clone());
        self.store.write(path, &state)?;
        let staged = instance
            .stage_native_import(owner, plan)
            .map_err(|_| PENDING)?;
        if staged.source_sha256 != candidate.native_digest
            || staged.import_id != candidate.import_id
        {
            return Err(UNAVAILABLE);
        }
        self.store
            .write_receipt(path, &candidate.request_key, staged.receipt_digest)?;
        candidate.receipt = Some(staged.receipt_digest);
        state.available = true;
        state.pending = None;
        state.accepted = Some(candidate);
        self.store.write(path, &state)?;
        self.schedule(instance, owner, &staged.import_id);
        Ok(receipt(request, hex(&staged.receipt_digest)))
    }

    fn recover_pending(
        &self,
        instance: &Instance,
        owner: OwnerId,
        state: &mut SourceState,
        path: &Path,
    ) -> Result<(), HttpError> {
        if let Some(pending) = &state.pending {
            let status = instance
                .native_import_status(owner, &pending.import_id)
                .map_err(|_| UNAVAILABLE)?;
            match status {
                None => state.pending = None,
                Some(status) => {
                    if status.source_key != hex(&pending.native_digest) {
                        return Err(UNAVAILABLE);
                    }
                    if let Some(receipt) = status.receipt_digest {
                        self.store
                            .write_receipt(path, &pending.request_key, receipt)?;
                        let mut accepted = state.pending.take().ok_or(UNAVAILABLE)?;
                        accepted.receipt = Some(receipt);
                        state.available = !state.terminal && !state.stale;
                        state.accepted = Some(accepted);
                    }
                }
            }
        }
        Ok(())
    }

    fn tombstone(
        &mut self,
        instance: &Instance,
        owner: OwnerId,
        request: &SourceRequest,
        state: &mut SourceState,
        path: &Path,
    ) -> Result<(), HttpError> {
        if state.pending.is_some() {
            self.recover_pending(instance, owner, state, path)?;
            if state.pending.is_some() {
                return Err(PENDING);
            }
            self.store.write(path, state)?;
        }
        if let Some(accepted) = &state.accepted {
            // An already-open native epoch must settle under Root. The terminal
            // host fence is durable even while this product operation waits.
            instance
                .tombstone_hermes_copy(owner, &scope(request)?, accepted.native_digest)
                .map_err(|_| PENDING)?;
        }
        Ok(())
    }

    pub(crate) fn resume(&mut self, instance: &Instance, owner: OwnerId, session: &str) {
        let path = self.store.path(session);
        if let Ok(state) = self.store.read(&path) {
            if !state.terminal {
                if let Some(head) = state.accepted {
                    self.schedule(instance, owner, &head.import_id);
                }
            }
        }
    }

    fn schedule(&mut self, instance: &Instance, owner: OwnerId, import_id: &str) {
        let Some(runtime) = self.runtime.as_ref() else {
            return;
        };
        if self.jobs.get(&owner).is_some_and(|job| !job.is_finished()) {
            return;
        }
        if let Some(job) = self.jobs.remove(&owner) {
            let _ = job.join();
        }
        if !instance
            .native_import_status(owner, import_id)
            .ok()
            .flatten()
            .is_some_and(|status| {
                matches!(
                    status.state,
                    NativeImportState::Staged | NativeImportState::Settled
                )
            })
        {
            return;
        }
        if let Ok(job) = instance.start_processing(
            owner,
            runtime,
            ProcessOptions {
                import_id: Some(import_id.to_owned()),
                destination: None,
                ..ProcessOptions::default()
            },
        ) {
            self.jobs.insert(owner, job);
        }
    }
}

fn overlap(previous: &SourceHead, snapshot: &Snapshot) -> Option<usize> {
    if previous.branch != snapshot.branch {
        return None;
    }
    let leaf = previous.evidence.last()?;
    let matched = snapshot
        .evidence
        .iter()
        .position(|row| row.uid == leaf.uid)?
        + 1;
    let prefix: &[Evidence] = snapshot.evidence.get(..matched)?;
    previous.evidence.ends_with(prefix).then_some(matched)
}

fn scope(request: &SourceRequest) -> Result<HermesCopyScope, HttpError> {
    HermesCopyScope::new(request.profile_id.clone(), request.session_id.clone())
        .map_err(|_| INVALID)
}

fn verify_key(request: &SourceRequest, digest: Option<&str>) -> Result<(), HttpError> {
    let kind = match request.operation {
        SourceAction::Snapshot => "snapshot",
        SourceAction::Invalidate => "invalidate",
        SourceAction::Terminal => "terminal",
    };
    let raw = serde_json::to_vec(&(
        "hermes-source-outbox-v1",
        &request.profile_id,
        &request.principal_id,
        &request.session_id,
        kind,
        request.generation,
        digest,
    ))
    .map_err(|_| INVALID)?;
    if request.idempotency_key != hex(&Sha256::digest(raw)) {
        return Err(INVALID);
    }
    Ok(())
}

fn receipt(request: &SourceRequest, receipt: String) -> HttpResponse {
    HttpResponse::ok(json!({
        "session_id": request.session_id,
        "generation": request.generation,
        "idempotency_key": request.idempotency_key,
        "receipt": receipt,
        "durable": true,
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProcessingConfig {
    config_path: std::path::PathBuf,
}

fn configured_runtime(state_dir: &Path) -> Result<Option<ConfiguredRuntime>, &'static str> {
    let path = state_dir.join("processing.json");
    match path.symlink_metadata() {
        Ok(metadata) if metadata.is_file() => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        _ => return Err("invalid_processing_config"),
    }
    let mut raw = Vec::new();
    File::open(path)
        .and_then(|file| file.take(8193).read_to_end(&mut raw))
        .map_err(|_| "invalid_processing_config")?;
    if raw.len() > 8192 {
        return Err("invalid_processing_config");
    }
    let config: ProcessingConfig =
        crate::service_protocol::decode(&raw).map_err(|_| "invalid_processing_config")?;
    if !config.config_path.is_absolute() || !config.config_path.is_file() {
        return Err("invalid_processing_config");
    }
    ConfiguredRuntime::from_path(&config.config_path)
        .map(Some)
        .map_err(|_| "invalid_processing_config")
}
