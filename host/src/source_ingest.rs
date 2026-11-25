//! Map authenticated source work to the native Root import and maintenance flows.
use crate::{
    registry::Registry,
    runtime::RuntimeRegistry,
    service_http::{HttpError, HttpResponse, INVALID, UNAVAILABLE, hex},
    source_store::{PendingRewind, SourceHead, SourceState, SourceStore},
    source_wire::{Evidence, RewindArguments, Snapshot, SourceAction, SourceRequest},
};
use reliquary_memory::{
    ConfiguredRuntime, HermesCopiedRole, HermesCopiedSnapshot, HermesCopyScope,
    HermesCopySourceChange, Instance, NativeImportPlan, NativeImportState, OwnerId,
    OwnerProcessingJob, ProcessOptions, SourceAvailability, SourceTurn,
};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::Arc,
};

const STALE: HttpError = HttpError::new(409, "source_generation_stale", false);
const UNRECONCILED: HttpError = HttpError::new(409, "source_revision_unreconciled", false);
const TERMINAL: HttpError = HttpError::new(409, "source_terminal", false);
const RECOVERY_REQUIRED: HttpError = HttpError::new(409, "source_reconciliation_required", true);
const PENDING: HttpError = HttpError::new(503, "source_import_pending", true);
const PHY_INACTIVE: HttpError = HttpError::new(409, "source_phy_inactive", true);

const PROVENANCE_UNAVAILABLE: HttpError =
    HttpError::new(503, "source_provenance_unavailable", true);

mod retrieval;

pub(crate) struct DashboardSourceStatus {
    pub(crate) state: &'static str,
    pub(crate) cursor: Option<String>,
    pub(crate) receipt: Option<String>,
    pub(crate) import_id: Option<String>,
}

#[derive(Clone, Copy)]
pub(crate) struct SourceBinding {
    pub(crate) rel: OwnerId,
    pub(crate) phy: OwnerId,
}

pub(crate) struct SourceService {
    store: SourceStore,
    runtime: Option<Arc<ConfiguredRuntime>>,
    jobs: BTreeMap<OwnerId, OwnerProcessingJob>,
    active_imports: BTreeMap<OwnerId, String>,
}

impl SourceService {
    pub(crate) fn open(state_dir: &Path) -> Result<Self, &'static str> {
        Ok(Self {
            store: SourceStore::open(state_dir)?,
            runtime: None,
            jobs: BTreeMap::new(),
            active_imports: BTreeMap::new(),
        })
    }

    pub(crate) fn bind_runtime(&mut self, runtime: Arc<ConfiguredRuntime>) {
        self.runtime = Some(runtime);
    }

    pub(crate) fn dashboard_status(
        &self,
        session: &str,
        registry: &Registry,
        runtimes: &mut RuntimeRegistry,
    ) -> Result<DashboardSourceStatus, HttpError> {
        let state = self.store.read(&self.store.path(session))?;
        if !source_phy_is_active(&state, registry) {
            return Err(PHY_INACTIVE);
        }
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

    pub(crate) fn import_status(
        &self,
        session: &str,
        instance: &Instance,
        registry: &Registry,
        runtimes: &mut RuntimeRegistry,
    ) -> Result<serde_json::Value, HttpError> {
        let state = self.store.read(&self.store.path(session))?;
        if !source_phy_is_active(&state, registry) {
            return Ok(
                json!({"session_id": session, "state": "unavailable", "receipt": null,
                             "import_id": null, "owner_id": null, "snapshot_digest": null}),
            );
        }
        let head = state.pending.as_ref().or(state.accepted.as_ref());
        let owner_id = if head.is_some() {
            match state.owner_id.as_deref() {
                Some(value) => Some(value.parse::<OwnerId>().map_err(|_| UNAVAILABLE)?),
                None => registry.source_owner(session, true).ok(),
            }
        } else {
            None
        };
        let Some(head) = head else {
            return Ok(
                json!({"session_id": session, "state": if state.terminal { "tombstoned" } else { "none" },
                             "receipt": null, "import_id": null, "owner_id": null, "snapshot_digest": null}),
            );
        };
        let Some(owner) = owner_id else {
            return Err(UNAVAILABLE);
        };
        let fenced = runtimes
            .has_fence("hermes", session)
            .map_err(|_| UNAVAILABLE)?;
        if state.terminal {
            return Ok(
                json!({"session_id": session, "state": "tombstoned", "receipt": null,
                             "import_id": null, "owner_id": owner.to_string(), "snapshot_digest": head.wire_digest}),
            );
        }
        if state.stale || fenced {
            return Ok(
                json!({"session_id": session, "state": "unavailable", "receipt": null,
                             "import_id": head.import_id, "owner_id": owner.to_string(),
                             "snapshot_digest": head.wire_digest}),
            );
        }
        let status = instance
            .native_import_status(owner, &head.import_id)
            .map_err(|_| UNAVAILABLE)?;
        let Some(status) = status else {
            return Ok(
                json!({"session_id": session, "state": "unavailable", "receipt": null,
                             "import_id": head.import_id, "owner_id": owner.to_string(),
                             "snapshot_digest": head.wire_digest}),
            );
        };
        let label = match status {
            status if status.state == NativeImportState::Completed => "complete",
            status if status.state == NativeImportState::Staging => "processing",
            _status
                if self.active_imports.get(&owner) == Some(&head.import_id)
                    && self.jobs.get(&owner).is_some_and(|job| !job.is_finished()) =>
            {
                "processing"
            }
            status => {
                let progress = instance
                    .processing_status(owner, Some(&head.import_id))
                    .map_err(|_| UNAVAILABLE)?;
                if progress.failed > 0 || progress.held > 0 {
                    "failed"
                } else if progress.processing > 0 {
                    "processing"
                } else if status.state == NativeImportState::Staged
                    || status.state == NativeImportState::Settled
                {
                    "staged"
                } else {
                    "unavailable"
                }
            }
        };
        Ok(json!({"session_id": session, "state": label,
                  "receipt": head.receipt.map(|value| hex(&value)), "import_id": head.import_id,
                  "owner_id": owner.to_string(), "snapshot_digest": head.wire_digest}))
    }

    pub(crate) fn resume_all(
        &mut self,
        instance: &Instance,
        registry: &Registry,
        runtimes: &mut RuntimeRegistry,
        mut embedding_allowed: impl FnMut(OwnerId) -> bool,
    ) -> Result<(), HttpError> {
        if self.runtime.is_none() {
            return Ok(());
        }
        let store = self.store.clone();
        let mut resumed = 0;
        store.visit_resumable_imports(|session, owner_id, import_id, manual, phy| {
            if phy.unwrap_or_else(|| registry.legacy_phy()) != registry.active_phy() {
                return true;
            }
            let Some(owner) = resumable_owner(registry, &session, Some(&owner_id), manual) else {
                return true;
            };
            if runtimes.has_fence("hermes", &session).unwrap_or(true) || !embedding_allowed(owner) {
                return true;
            }
            let status = instance
                .native_import_status(owner, &import_id)
                .ok()
                .flatten();
            if status.is_some_and(|status| {
                matches!(
                    status.state,
                    NativeImportState::Staged | NativeImportState::Settled
                )
            }) {
                if self.schedule(instance, owner, &import_id) {
                    resumed += 1;
                }
            }
            resumed < 130
        });
        Ok(())
    }

    pub(crate) fn handle(
        &mut self,
        instance: &Instance,
        binding: SourceBinding,
        request: SourceRequest,
        reconciliation_required: bool,
        bind_embedding_identity: impl FnOnce() -> Result<(), HttpError>,
    ) -> Result<HttpResponse, HttpError> {
        let snapshot = if request.operation.is_snapshot() {
            Some(Snapshot::parse(&request)?)
        } else {
            None
        };
        verify_key(
            &request,
            snapshot.as_ref().map(|snapshot| snapshot.digest.as_str()),
        )?;
        let mut bind_embedding_identity = Some(bind_embedding_identity);
        let path = self.store.path(&request.session_id);
        let mut state = self.store.read(&path)?;
        state.session_id = Some(request.session_id.clone());
        let owner = binding.rel;
        let selected_owner = owner.to_string();
        if state
            .owner_id
            .as_deref()
            .is_some_and(|value| value != selected_owner)
        {
            return Err(HttpError::new(409, "source_owner_conflict", false));
        }
        if state.phy_id.is_some_and(|phy| phy != binding.phy) {
            return Err(PHY_INACTIVE);
        }
        if state.owner_id.is_some() {
            state.phy_id = Some(binding.phy);
        }
        // Manual extensions follow the same verified source-head overlap as live snapshots.
        // Reusing a source ID with changed history fails in submit()'s continuity check.
        if request.operation == SourceAction::Terminal {
            if request.arguments["reason"] == "archive" {
                return Ok(receipt(&request, request.idempotency_key.clone()));
            }
            if state.terminal_acknowledged {
                return Ok(receipt(&request, request.idempotency_key.clone()));
            }
            if !state.terminal || request.generation > state.generation {
                state.generation = state.generation.max(request.generation);
                state.terminal = true;
                state.available = false;
                self.store.write(&path, &state)?;
            }
            self.settle_before_removal(
                instance,
                owner,
                &request,
                &mut state,
                &path,
                bind_embedding_identity.take(),
            )?;
            if let Some(accepted) = &state.accepted {
                instance
                    .apply_hermes_copy_source_change(
                        owner,
                        &scope(&request)?,
                        accepted.native_digest,
                        &request.idempotency_key,
                        HermesCopySourceChange::Delete,
                    )
                    .map_err(|_| PENDING)?;
            }
            state.terminal_acknowledged = true;
            self.store.write(&path, &state)?;
            return Ok(receipt(&request, request.idempotency_key.clone()));
        }
        if state.terminal {
            return Err(TERMINAL);
        }
        if request.operation == SourceAction::Rewind {
            if state.last_rewind_key.as_deref() == Some(&request.idempotency_key)
                || self
                    .store
                    .read_receipt(&path, &request.idempotency_key)?
                    .is_some()
            {
                return Ok(receipt(&request, request.idempotency_key.clone()));
            }
            if request.generation < state.generation {
                return Err(STALE);
            }
            let change = RewindArguments::parse(&request)?;
            state.generation = request.generation;
            // Keep the copy unavailable while the durable owner-side change is pending.
            state.stale = true;
            state.available = false;
            self.store.write(&path, &state)?;
            self.settle_before_removal(
                instance,
                owner,
                &request,
                &mut state,
                &path,
                bind_embedding_identity.take(),
            )?;
            if state.pending_rewind.is_none()
                && let Some(head) = &state.accepted
                && let Some(retained_message_uid) =
                    Self::rewind_cut(instance, owner, &request, &change, head)?
            {
                state.pending_rewind = Some(PendingRewind {
                    request_key: request.idempotency_key.clone(),
                    retained_message_uid,
                });
                self.store.write(&path, &state)?;
            }
            if let Some(cut) = &state.pending_rewind {
                if cut.request_key != request.idempotency_key {
                    return Err(PENDING);
                }
                let head = state.accepted.as_mut().ok_or(UNAVAILABLE)?;
                Self::apply_rewind(instance, owner, &request, &change.event_id, head, cut)?;
                state.pending_rewind = None;
            }
            state.stale = false;
            state.available = state.accepted.is_some();
            state.last_rewind_key = Some(request.idempotency_key.clone());
            self.store.write(&path, &state)?;
            let key: [u8; 32] = Sha256::digest(request.idempotency_key.as_bytes()).into();
            self.store
                .write_receipt(&path, &request.idempotency_key, key)?;
            return Ok(receipt(&request, request.idempotency_key.clone()));
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
        if request.operation.is_manual() && state.accepted.is_none() && state.pending.is_none() {
            state.manual = true;
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
            binding,
            &request,
            snapshot.ok_or(INVALID)?,
            &path,
            state,
            bind_embedding_identity,
        )
    }

    fn submit(
        &mut self,
        instance: &Instance,
        binding: SourceBinding,
        request: &SourceRequest,
        snapshot: Snapshot,
        path: &Path,
        mut state: SourceState,
        mut bind_embedding_identity: Option<impl FnOnce() -> Result<(), HttpError>>,
    ) -> Result<HttpResponse, HttpError> {
        let owner = binding.rel;
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
            if let Some(accepted) = &state.accepted
                && bind_embedding_identity
                    .take()
                    .is_some_and(|bind| bind().is_ok())
            {
                self.schedule(instance, owner, &accepted.import_id);
            }
            return Ok(receipt(request, hex(&evidence)));
        }
        let skip = if let Some(accepted) = &state.accepted {
            let overlap = overlap(accepted, &snapshot);
            if let Some(anchor) = accepted.rewind_anchor.as_deref() {
                let active = instance
                    .read_hermes_copy_source(
                        owner,
                        &scope(request)?,
                        accepted.native_digest,
                        anchor,
                        anchor,
                    )
                    .map_err(|_| PENDING)?
                    .ok_or(PENDING)?;
                let [original] = active.as_slice() else {
                    return Err(PENDING);
                };
                let matching = overlap
                    .and_then(|length| length.checked_sub(1))
                    .and_then(|index| snapshot.messages.get(index));
                if matching.is_none_or(|message| {
                    let role = match message.role {
                        HermesCopiedRole::User => "user",
                        HermesCopiedRole::Assistant => "assistant",
                        HermesCopiedRole::Commentary => "commentary",
                        HermesCopiedRole::System => "system",
                        HermesCopiedRole::Tool => "tool",
                    };
                    message.content != original.archive.content
                        || message.timestamp_ns != original.archive.timestamp_ns
                        || role != original.archive.role
                }) {
                    return Err(UNRECONCILED);
                }
            }
            let Some(skip) = overlap else {
                if !reconciling {
                    state.available = false;
                    state.stale = true;
                    self.store.write(path, &state)?;
                }
                return Err(UNRECONCILED);
            };
            if skip == snapshot.messages.len() {
                let evidence = accepted.receipt.ok_or(UNAVAILABLE)?;
                self.store
                    .write_receipt(path, &request.idempotency_key, evidence)?;
                if bind_embedding_identity
                    .take()
                    .is_some_and(|bind| bind().is_ok())
                {
                    self.schedule(instance, owner, &accepted.import_id);
                }
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
        let plan = copied_plan(
            scope(request)?,
            snapshot.branch.clone(),
            snapshot.revision,
            snapshot.messages.into_iter().skip(skip).collect(),
            state.accepted.as_ref(),
        )?;
        let mut candidate = SourceHead {
            wire_digest: snapshot.digest,
            request_key: request.idempotency_key.clone(),
            native_digest: plan.source_sha256(),
            import_id: plan.import_id(owner),
            branch: snapshot.branch,
            evidence: snapshot.evidence,
            rewind_anchor: None,
            receipt: None,
        };
        if state
            .pending
            .as_ref()
            .is_some_and(|head| head.native_digest != candidate.native_digest)
        {
            return Err(UNAVAILABLE);
        }
        state.owner_id = Some(owner.to_string());
        state.phy_id = Some(binding.phy);
        state.pending = Some(candidate.clone());
        state.pending_snapshot = Some(request.arguments.clone());
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
        state.pending_snapshot = None;
        state.accepted = Some(candidate);
        self.store.write(path, &state)?;
        if bind_embedding_identity
            .take()
            .is_some_and(|bind| bind().is_ok())
        {
            self.schedule(instance, owner, &staged.import_id);
        }
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
                None => {
                    state.pending = None;
                    state.pending_snapshot = None;
                }
                Some(status) => {
                    if status.source_key != hex(&pending.native_digest) {
                        return Err(UNAVAILABLE);
                    }
                    if let Some(receipt) = status.receipt_digest {
                        self.store
                            .write_receipt(path, &pending.request_key, receipt)?;
                        let mut accepted = state.pending.take().ok_or(UNAVAILABLE)?;
                        state.pending_snapshot = None;
                        accepted.receipt = Some(receipt);
                        state.available = !state.terminal && !state.stale;
                        state.accepted = Some(accepted);
                    }
                }
            }
        }
        Ok(())
    }

    fn settle_before_removal(
        &mut self,
        instance: &Instance,
        owner: OwnerId,
        request: &SourceRequest,
        state: &mut SourceState,
        path: &Path,
        bind_embedding_identity: Option<impl FnOnce() -> Result<(), HttpError>>,
    ) -> Result<(), HttpError> {
        if state.pending.is_some() {
            self.recover_pending(instance, owner, state, path)?;
            if let Some(pending) = &state.pending {
                let args = state.pending_snapshot.as_ref().ok_or(PENDING)?;
                let snapshot =
                    Snapshot::parse_arguments(args, &request.profile_id, &request.session_id)?;
                let skip = match &state.accepted {
                    Some(head) => overlap(head, &snapshot).ok_or(PENDING)?,
                    None => 0,
                };
                let plan = copied_plan(
                    scope(request)?,
                    snapshot.branch,
                    snapshot.revision,
                    snapshot.messages.into_iter().skip(skip).collect(),
                    state.accepted.as_ref(),
                )?;
                if plan.source_sha256() != pending.native_digest
                    || plan.import_id(owner) != pending.import_id
                {
                    return Err(PENDING);
                }
                instance
                    .stage_native_import(owner, plan)
                    .map_err(|_| PENDING)?;
                self.recover_pending(instance, owner, state, path)?;
            }
            self.store.write(path, state)?;
        }
        if let Some(accepted) = &state.accepted
            && bind_embedding_identity.is_some_and(|bind| bind().is_ok())
        {
            self.schedule(instance, owner, &accepted.import_id);
        }
        Ok(())
    }

    /// Outer None means that the committed deletion affected only uncopied messages.
    /// Inner None means that every copied message was removed.
    fn rewind_cut(
        instance: &Instance,
        owner: OwnerId,
        request: &SourceRequest,
        change: &RewindArguments,
        head: &SourceHead,
    ) -> Result<Option<Option<String>>, HttpError> {
        let scope = scope(request)?;
        let removed = change
            .removed_message_uids
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        let mut from_leaf = 0;
        loop {
            let page = instance
                .read_hermes_copy_active_message_uids(
                    owner,
                    &scope,
                    head.native_digest,
                    from_leaf,
                    128,
                )
                .map_err(|_| PENDING)?
                .ok_or(PENDING)?;
            for (offset, uid) in page.iter().enumerate() {
                if change.last_surviving_message_uid.as_ref() == Some(uid) {
                    return Ok((from_leaf + offset > 0).then(|| Some(uid.clone())));
                }
                if change.removed_uids_complete && !removed.contains(uid.as_str()) {
                    if from_leaf + offset == 0
                        && page.iter().any(|uid| removed.contains(uid.as_str()))
                    {
                        return Err(PENDING);
                    }
                    return Ok((from_leaf + offset > 0).then(|| Some(uid.clone())));
                }
            }
            if page.len() < 128 {
                return if change.removed_uids_complete
                    || change.last_surviving_message_uid.is_none()
                {
                    Ok((from_leaf + page.len() > 0).then_some(None))
                } else {
                    Err(PENDING)
                };
            }
            from_leaf += page.len();
        }
    }

    fn apply_rewind(
        instance: &Instance,
        owner: OwnerId,
        request: &SourceRequest,
        event_id: &str,
        head: &mut SourceHead,
        cut: &PendingRewind,
    ) -> Result<(), HttpError> {
        let receipt = instance
            .apply_hermes_copy_source_change(
                owner,
                &scope(request)?,
                head.native_digest,
                event_id,
                HermesCopySourceChange::Rewind {
                    last_surviving_message_uid: cut.retained_message_uid.clone(),
                },
            )
            .map_err(|_| PENDING)?;
        head.native_digest = receipt.resulting_head_sha256.ok_or(UNAVAILABLE)?;
        if let Some(index) = head
            .evidence
            .iter()
            .position(|row| Some(&row.uid) == cut.retained_message_uid.as_ref())
        {
            head.evidence.truncate(index + 1);
            head.rewind_anchor = None;
        } else {
            head.evidence.clear();
            head.rewind_anchor.clone_from(&cut.retained_message_uid);
        }
        Ok(())
    }

    fn accepted_source_head(
        &self,
        session: &str,
        runtimes: &mut RuntimeRegistry,
    ) -> Result<Option<SourceHead>, HttpError> {
        let state = self.store.read(&self.store.path(session))?;
        if state.terminal && !state.terminal_acknowledged {
            return Err(TERMINAL);
        }
        if !state.terminal_acknowledged
            && (state.stale
                || runtimes
                    .has_fence("hermes", session)
                    .map_err(|_| UNAVAILABLE)?)
        {
            return Err(RECOVERY_REQUIRED);
        }
        // This sidecar supplies a wire provenance digest and fences pending
        // synchronization. Core decides which copied content is current.
        if state.pending.is_some() {
            return Err(PENDING);
        }
        Ok(state.accepted)
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
        if scope.conversation_id() != turn.conversation_id {
            return Err("unauthorized");
        }
        self.accepted_source_head(session, runtimes)
            .map_err(|error| match error.code() {
                "source_terminal" => "deleted",
                "source_reconciliation_required" => "stale",
                _ => "missing",
            })?;
        let expected_owner = self
            .source_owner(session)
            .map_err(|_| "unauthorized")?
            .or_else(|| registry.source_owner(session, true).ok());
        if expected_owner != owner {
            return Err("unauthorized");
        }
        // Core resolves the exact imported node and its removal cut. The
        // host authenticates the route and fences removal still being synced.
        if imported.format != "hermes-source-copied-snapshot-v1"
            || imported.message_id != turn.node_id
            || !matches!(&turn.availability, SourceAvailability::Available)
        {
            return Err("missing");
        }
        Ok(())
    }

    pub(crate) fn has_source_head(&self, session: &str) -> Result<bool, HttpError> {
        let state = self.store.read(&self.store.path(session))?;
        Ok(state.accepted.is_some() || state.pending.is_some())
    }

    pub(crate) fn source_owner(&self, session: &str) -> Result<Option<OwnerId>, HttpError> {
        let state = self.store.read(&self.store.path(session))?;
        match state.owner_id {
            Some(value) => value.parse::<OwnerId>().map(Some).map_err(|_| UNAVAILABLE),
            None => Ok(None),
        }
    }

    pub(crate) fn source_phy(&self, session: &str) -> Result<Option<OwnerId>, HttpError> {
        Ok(self.store.read(&self.store.path(session))?.phy_id)
    }

    pub(crate) fn has_active_jobs(&self) -> bool {
        self.jobs.values().any(|job| !job.is_finished())
    }

    pub(crate) fn is_terminal(&self, session: &str) -> Result<bool, HttpError> {
        Ok(self.store.read(&self.store.path(session))?.terminal)
    }

    pub(crate) fn resume(
        &mut self,
        instance: &Instance,
        registry: &Registry,
        session: &str,
        embedding_allowed: impl FnOnce(OwnerId) -> bool,
    ) {
        let Ok(state) = self.store.read(&self.store.path(session)) else {
            return;
        };
        if state.terminal || !source_phy_is_active(&state, registry) {
            return;
        }
        if let Some(head) = state.accepted
            && let Some(owner) =
                resumable_owner(registry, session, state.owner_id.as_deref(), state.manual)
            && embedding_allowed(owner)
        {
            self.schedule(instance, owner, &head.import_id);
        }
    }

    fn schedule(&mut self, instance: &Instance, owner: OwnerId, import_id: &str) -> bool {
        let Some(runtime) = self.runtime.as_ref() else {
            return false;
        };
        if self.jobs.get(&owner).is_some_and(|job| !job.is_finished()) {
            return false;
        }
        if let Some(job) = self.jobs.remove(&owner) {
            let _ = job.join();
            self.active_imports.remove(&owner);
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
            return false;
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
            self.active_imports.insert(owner, import_id.to_owned());
            return true;
        }
        false
    }
}

fn source_phy_is_active(state: &SourceState, registry: &Registry) -> bool {
    // Control-only records can exist before the first admitted snapshot.
    let bound = state.owner_id.is_some() || state.accepted.is_some() || state.pending.is_some();
    !bound || state.phy_id.unwrap_or_else(|| registry.legacy_phy()) == registry.active_phy()
}

fn resumable_owner(
    registry: &Registry,
    session: &str,
    owner_id: Option<&str>,
    manual: bool,
) -> Option<OwnerId> {
    if manual {
        return registry.retained_source_owner(owner_id?).ok();
    }
    let owner = registry.source_owner(session, true).ok()?;
    if let Some(expected) = owner_id
        && expected.parse::<OwnerId>().ok() != Some(owner)
    {
        return None;
    }
    Some(owner)
}

fn overlap(previous: &SourceHead, snapshot: &Snapshot) -> Option<usize> {
    if previous.branch != snapshot.branch {
        return None;
    }
    let Some(leaf) = previous.evidence.last() else {
        return match previous.rewind_anchor.as_deref() {
            Some(anchor) => snapshot
                .evidence
                .iter()
                .position(|row| row.uid == anchor)
                .map(|index| index + 1),
            None => Some(0),
        };
    };
    let matched = snapshot
        .evidence
        .iter()
        .position(|row| row.uid == leaf.uid)?
        + 1;
    let prefix: &[Evidence] = snapshot.evidence.get(..matched)?;
    previous.evidence.ends_with(prefix).then_some(matched)
}

fn copied_plan(
    scope: HermesCopyScope,
    branch_id: Option<String>,
    source_revision: Option<String>,
    messages: Vec<reliquary_memory::HermesCopiedMessage>,
    previous: Option<&SourceHead>,
) -> Result<NativeImportPlan, HttpError> {
    let native = HermesCopiedSnapshot {
        scope,
        branch_id,
        source_revision,
        messages,
    };
    match previous {
        Some(head) => NativeImportPlan::from_hermes_copy_extension(native, head.native_digest),
        None => NativeImportPlan::from_hermes_copy(native),
    }
    .map_err(|_| INVALID)
}

fn scope(request: &SourceRequest) -> Result<HermesCopyScope, HttpError> {
    HermesCopyScope::new(request.profile_id.clone(), request.session_id.clone())
        .map_err(|_| INVALID)
}

fn verify_key(request: &SourceRequest, digest: Option<&str>) -> Result<(), HttpError> {
    let kind = match request.operation {
        SourceAction::Snapshot | SourceAction::ManualSnapshot => "snapshot",
        SourceAction::Invalidate => "invalidate",
        SourceAction::Rewind => "rewind",
        SourceAction::Terminal => "terminal",
    };
    let change_digest = if request.operation == SourceAction::Rewind {
        let raw = serde_json::to_vec(&request.arguments).map_err(|_| INVALID)?;
        Some(hex(&Sha256::digest(raw)))
    } else {
        None
    };
    let digest = change_digest.as_deref().or(digest);
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
    if request.operation.is_manual() {
        parts.extend([json!("manual"), json!(request.target_owner_id)]);
        if let Some(phy) = &request.expected_phy_id {
            parts.push(json!(phy));
        }
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
