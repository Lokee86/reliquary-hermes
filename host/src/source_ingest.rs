//! Map authenticated source work to the native Root import and maintenance flows.
use crate::{
    registry::Registry,
    runtime::RuntimeRegistry,
    service_http::{HttpError, HttpResponse, INVALID, UNAVAILABLE, hex},
    source_store::{SourceHead, SourceState, SourceStore},
    source_wire::{Evidence, Snapshot, SourceAction, SourceRequest},
};
use reliquary_memory::{
    ConfiguredRuntime, HermesCopiedSnapshot, HermesCopyScope, InspectionItem, InspectionQuery,
    Instance, MemoryId, NativeImportPlan, NativeImportState, OwnerId, OwnerProcessingJob,
    ProcessOptions, RetrievalMemory, RetrievalPreview, SourceAvailability, SourceTurn,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::File,
    io::Read,
    path::Path,
};

const STALE: HttpError = HttpError::new(409, "source_generation_stale", false);
const UNRECONCILED: HttpError = HttpError::new(409, "source_revision_unreconciled", false);
const TERMINAL: HttpError = HttpError::new(409, "source_terminal", false);
const RECOVERY_REQUIRED: HttpError = HttpError::new(409, "source_reconciliation_required", true);
const PENDING: HttpError = HttpError::new(503, "source_import_pending", true);

const PROVENANCE_UNAVAILABLE: HttpError =
    HttpError::new(503, "source_provenance_unavailable", true);

#[derive(Serialize)]
pub(crate) struct RetrievalProvenance {
    memory_id: String,
    source_snapshot_digests: Vec<String>,
}

pub(crate) struct DashboardSourceStatus {
    pub(crate) state: &'static str,
    pub(crate) cursor: Option<String>,
    pub(crate) receipt: Option<String>,
    pub(crate) import_id: Option<String>,
}

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

    pub(crate) fn dashboard_status(
        &self,
        session: &str,
        runtimes: &mut RuntimeRegistry,
    ) -> Result<DashboardSourceStatus, HttpError> {
        let state = self.store.read(&self.store.path(session))?;
        let fenced = runtimes
            .has_fence("hermes", session)
            .map_err(|_| UNAVAILABLE)?;
        let label = if state.terminal {
            "tombstoned"
        } else if state.stale || fenced {
            "stale"
        } else if state.available && state.accepted.is_some() {
            "active"
        } else if state.accepted.is_none() && state.pending.is_none() {
            "none"
        } else {
            "unavailable"
        };
        // The accepted snapshot digest identifies the source head without exposing
        // a Hermes message UID, outbox key, content, or a storage path.
        let cursor = state.accepted.as_ref().map(|head| head.wire_digest.clone());
        let receipt = state
            .accepted
            .as_ref()
            .and_then(|head| head.receipt)
            .map(|receipt| hex(&receipt));
        let import_id = state
            .pending
            .as_ref()
            .or(state.accepted.as_ref())
            .map(|head| head.import_id.clone());
        Ok(DashboardSourceStatus {
            state: label,
            cursor,
            receipt,
            import_id,
        })
    }

    pub(crate) fn handle(
        &mut self,
        instance: &Instance,
        owner: OwnerId,
        request: SourceRequest,
        reconciliation_required: bool,
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
        if reconciliation_required && request.fence_epoch.is_none() {
            return Err(RECOVERY_REQUIRED);
        }
        if request.generation != state.generation {
            return Err(STALE);
        }
        if state.stale {
            return Err(UNRECONCILED);
        }
        if request.fence_epoch.is_some() && !reconciliation_required {
            // A recovery receipt may have reached disk just before the reply
            // was lost. An already resolved epoch can only replay that receipt.
            let evidence = self
                .store
                .read_receipt(&path, &request.idempotency_key)?
                .ok_or(HttpError::new(409, "source_fence_epoch_stale", false))?;
            return Ok(receipt(&request, hex(&evidence)));
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
        let reconciling = request.fence_epoch.is_some();
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
        // Recovery must prove continuity with the latest accepted head, even
        // if this snapshot already has a receipt for an older accepted head.
        if !reconciling
            && let Some(evidence) = self.store.read_receipt(path, &request.idempotency_key)?
        {
            if let Some(accepted) = &state.accepted {
                self.schedule(instance, owner, &accepted.import_id);
            }
            return Ok(receipt(request, hex(&evidence)));
        }
        let skip = if let Some(accepted) = &state.accepted {
            let overlap = overlap(accepted, &snapshot);
            let Some(skip) = overlap else {
                if !reconciling {
                    state.available = false;
                    state.stale = true;
                    self.store.write(path, &state)?;
                }
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

    fn accepted_source_head(
        &self,
        session: &str,
        runtimes: &mut RuntimeRegistry,
    ) -> Result<SourceHead, HttpError> {
        let state = self.store.read(&self.store.path(session))?;
        if state.terminal {
            return Err(TERMINAL);
        }
        if state.stale
            || runtimes
                .has_fence("hermes", session)
                .map_err(|_| UNAVAILABLE)?
        {
            return Err(RECOVERY_REQUIRED);
        }
        state
            .accepted
            .filter(|_| state.available)
            .ok_or(PROVENANCE_UNAVAILABLE)
    }

    pub(crate) fn dashboard_provenance(
        &self,
        registry: &Registry,
        runtimes: &mut RuntimeRegistry,
        source_owner: Option<&str>,
        turn: &SourceTurn,
    ) -> Result<(), &'static str> {
        let imported = turn.imported.as_ref().ok_or("missing")?;
        let session = &imported.conversation_id;
        let scope = HermesCopyScope::new(registry.profile_id().to_owned(), session.clone())
            .map_err(|_| "unauthorized")?;
        let owner = source_owner.and_then(|id| id.parse::<OwnerId>().ok());
        if scope.conversation_id() != turn.conversation_id
            || Some(
                registry
                    .source_owner(session, true)
                    .map_err(|_| "unauthorized")?,
            ) != owner
        {
            return Err("unauthorized");
        }
        let head = self
            .accepted_source_head(session, runtimes)
            .map_err(|error| match error.code() {
                "source_terminal" => "deleted",
                "source_reconciliation_required" => "stale",
                _ => "missing",
            })?;
        // Root's accepted import proves the original digest. An append can
        // advance the head digest while retaining the original message.
        if !head
            .evidence
            .iter()
            .any(|row| row.uid == imported.message_id)
        {
            return Err("missing");
        }
        Ok(())
    }

    pub(crate) fn retrieval_provenance(
        &self,
        instance: &Instance,
        registry: &Registry,
        runtimes: &mut RuntimeRegistry,
        owner: OwnerId,
        selection: &RetrievalPreview,
    ) -> Result<Vec<RetrievalProvenance>, HttpError> {
        let management = instance
            .workspace_management(owner)
            .map_err(|_| PROVENANCE_UNAVAILABLE)?;
        let mut heads = BTreeMap::new();
        let mut provenance = Vec::with_capacity(selection.memories.len());
        for memory in &selection.memories {
            let mut digests = BTreeSet::new();
            if has_source(memory) {
                let page = management
                    .inspect(
                        &InspectionQuery::Provenance {
                            id: memory_id(&memory.memory_id)?,
                            revision: Some(memory.revision),
                        },
                        None,
                        1,
                    )
                    .map_err(|_| PROVENANCE_UNAVAILABLE)?;
                let [InspectionItem::Provenance(evidence)] = page.items.as_slice() else {
                    return Err(PROVENANCE_UNAVAILABLE);
                };
                if page.truncated
                    || evidence.memory_id != memory.memory_id
                    || evidence.body_id != memory.body_id
                    || evidence.revision != memory.revision
                {
                    return Err(PROVENANCE_UNAVAILABLE);
                }
                match evidence.availability {
                    SourceAvailability::Terminal => return Err(TERMINAL),
                    SourceAvailability::Available | SourceAvailability::Direct => {}
                    _ => return Err(PROVENANCE_UNAVAILABLE),
                }
                // Root resolves the original episode's turn as well as separate
                // content and grounding references (including cross-chat adoption).
                for turn in [
                    &evidence.source_turn,
                    &evidence.content_source,
                    &evidence.grounding_source,
                ]
                .into_iter()
                .flatten()
                {
                    if !turn.conversation_id.starts_with("hermes-copy:") {
                        continue;
                    }
                    let imported = turn
                        .imported
                        .as_ref()
                        .filter(|row| row.format == "hermes-source-copied-snapshot-v1")
                        .ok_or(PROVENANCE_UNAVAILABLE)?;
                    let session = &imported.conversation_id;
                    if !heads.contains_key(session) {
                        let scope =
                            HermesCopyScope::new(registry.profile_id().to_owned(), session.clone())
                                .map_err(|_| PROVENANCE_UNAVAILABLE)?;
                        if scope.conversation_id() != turn.conversation_id
                            || registry
                                .source_owner(session, true)
                                .map_err(|_| PROVENANCE_UNAVAILABLE)?
                                != owner
                        {
                            return Err(PROVENANCE_UNAVAILABLE);
                        }
                        let head = self.accepted_source_head(session, runtimes)?;
                        heads.insert(session.clone(), head);
                    }
                    let head = heads.get(session).ok_or(PROVENANCE_UNAVAILABLE)?;
                    if !head
                        .evidence
                        .iter()
                        .any(|row| row.uid == imported.message_id)
                    {
                        return Err(PROVENANCE_UNAVAILABLE);
                    }
                    digests.insert(head.wire_digest.clone());
                }
            }
            provenance.push(RetrievalProvenance {
                memory_id: memory.memory_id.clone(),
                source_snapshot_digests: digests.into_iter().collect(),
            });
        }
        Ok(provenance)
    }

    pub(crate) fn is_terminal(&self, session: &str) -> Result<bool, HttpError> {
        Ok(self.store.read(&self.store.path(session))?.terminal)
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

fn has_source(memory: &RetrievalMemory) -> bool {
    memory.source.episode_id.is_some()
        || memory.source.content_conversation_id.is_some()
        || memory.source.grounding_conversation_id.is_some()
}

fn memory_id(value: &str) -> Result<MemoryId, HttpError> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(PROVENANCE_UNAVAILABLE);
    }
    let mut bytes = [0; 32];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .map_err(|_| PROVENANCE_UNAVAILABLE)?;
    }
    Ok(MemoryId(bytes))
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
    let mut parts = vec![
        json!("hermes-source-outbox-v1"),
        json!(request.profile_id),
        json!(request.principal_id),
        json!(request.session_id),
        json!(kind),
        json!(request.generation),
        json!(digest),
    ];
    if let Some(epoch) = request.fence_epoch {
        parts.extend([json!("reconcile"), json!(request.lease_id), json!(epoch)]);
    }
    let raw = serde_json::to_vec(&parts).map_err(|_| INVALID)?;
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

pub(crate) fn configured_runtime(
    state_dir: &Path,
) -> Result<Option<ConfiguredRuntime>, &'static str> {
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
    open_processing_runtime(&config.config_path).map(Some)
}

pub(crate) fn open_processing_runtime(path: &Path) -> Result<ConfiguredRuntime, &'static str> {
    if !path.is_absolute() || !path.is_file() {
        return Err("invalid_processing_config");
    }
    ConfiguredRuntime::from_path(path).map_err(|_| "invalid_processing_config")
}
