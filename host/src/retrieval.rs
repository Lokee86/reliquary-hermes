//! Bounded, turn-scoped Root retrieval and exact selected-return delivery.
use crate::{
    registry::Registry,
    runtime::RuntimeRegistry,
    service_http::{HttpError, HttpResponse, INVALID, UNAVAILABLE, hex},
    service_protocol::{Operation, ProviderRequest},
    source_ingest::SourceService,
};
use reliquary_hermes_host::{ReturnOutcome, SelectedReturn};
use reliquary_memory::{
    ConfiguredRuntime, Instance, MemoryId, OwnerId, RetrievalMode, RetrievalPreview,
    RetrievalSession,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::Arc,
    sync::Mutex,
    time::{Duration, Instant},
};

const MAX_TURNS: usize = 64;
const TURN_TTL: Duration = Duration::from_secs(15 * 60);

type TurnKey = (String, String, String, String);

struct TurnState {
    session: RetrievalSession,
    last_search_id: Option<String>,
    last_cut: Option<String>,
    last_ids: Vec<String>,
    last_delivery_id: Option<String>,
    staged: Option<(String, String, reliquary_memory::PreparedMemoryDelivery)>,
    completed: BTreeSet<String>,
    touched: Instant,
}

pub(crate) struct RetrievalService {
    runtime: Option<Arc<ConfiguredRuntime>>,
    turns: BTreeMap<TurnKey, TurnState>,
}

impl RetrievalService {
    pub(crate) fn open(state_dir: &Path) -> Result<Self, &'static str> {
        Ok(Self {
            runtime: crate::source_ingest::configured_runtime(state_dir)?.map(Arc::new),
            turns: BTreeMap::new(),
        })
    }

    pub(crate) fn dashboard_recall(&self, session: &str) -> Value {
        let Some((_, state)) = self
            .turns
            .iter()
            .filter(|(key, state)| key.2 == session && state.touched.elapsed() <= TURN_TTL)
            .max_by_key(|(_, state)| state.touched)
        else {
            return no_dashboard_recall();
        };
        let (Some(search_id), Some(delivery_id)) = (&state.last_search_id, &state.last_delivery_id)
        else {
            return no_dashboard_recall();
        };
        // The Root preview exposes the exact approved selection. The wider
        // pre-decision candidate set is not exposed by this public API.
        json!({"state": "returned", "search_id": search_id, "delivery_id": delivery_id,
            "candidate_ids": state.last_ids, "selected_ids": state.last_ids, "returned_ids": state.last_ids})
    }

    pub(crate) fn invalidate_session(&mut self, session_id: &str, instance: &Instance) {
        self.turns.retain(|key, state| {
            if key.2 == session_id {
                if state.staged.is_some() {
                    let _ = instance.cancel_retrieval(&state.session);
                }
                false
            } else {
                true
            }
        });
    }

    pub(crate) fn prepare(
        &mut self,
        request: &ProviderRequest,
        raw: &[u8],
        instance: &Instance,
        owner: OwnerId,
    ) -> Result<HttpResponse, HttpError> {
        if request.operation != Operation::MemoryQuery {
            return Err(INVALID);
        }
        let runtime = self.runtime.clone().ok_or(UNAVAILABLE)?;
        let key = turn_key(request);
        self.prune(instance);
        let state = self.turn_mut(&key, instance, owner)?;
        let fingerprint = fingerprint(raw);
        if state.completed.contains(&fingerprint) {
            state.touched = Instant::now();
            return Ok(HttpResponse::ok(json!({"prepared": false})));
        }
        if let Some((staged_fingerprint, _, _)) = &state.staged {
            if staged_fingerprint == &fingerprint {
                state.touched = Instant::now();
                return Ok(HttpResponse::ok(json!({"prepared": true})));
            }
            let _ = instance.cancel_retrieval(&state.session);
            state.staged = None;
        }
        let outcome = instance
            .memory_query(&state.session, text_arg(request, "query")?, &runtime)
            .map_err(product_error)?;
        let Some(prepared) = outcome.prepared else {
            return Ok(HttpResponse::ok(json!({"prepared": false})));
        };
        let preview = match instance.preview_retrieval(&state.session, &prepared) {
            Ok(preview) => preview,
            Err(error) => {
                let _ = instance.cancel_retrieval(&state.session);
                return Err(product_error(error));
            }
        };
        if let Err(error) = validate_projection(&preview, request_limit(request)?) {
            let _ = instance.cancel_retrieval(&state.session);
            return Err(error);
        }
        let search_id = match mint_id() {
            Ok(id) => id,
            Err(error) => {
                let _ = instance.cancel_retrieval(&state.session);
                return Err(error);
            }
        };
        state.staged = Some((fingerprint, search_id, prepared));
        state.touched = Instant::now();
        // This response intentionally contains neither candidate content nor a
        // SelectedReturn receipt. Only the later /v1/request releases content.
        Ok(HttpResponse::ok(json!({"prepared": true})))
    }

    pub(crate) fn request(
        &mut self,
        request: &ProviderRequest,
        raw: &[u8],
        instance: &Instance,
        registry_mutex: &Mutex<Registry>,
        owner: OwnerId,
        sources_mutex: &Mutex<SourceService>,
        runtimes_mutex: &Mutex<RuntimeRegistry>,
        deadline: Instant,
    ) -> Result<Value, HttpError> {
        let runtime = self.runtime.clone().ok_or(UNAVAILABLE)?;
        let key = turn_key(request);
        self.prune(instance);
        let state = self.turn_mut(&key, instance, owner)?;
        state.touched = Instant::now();
        let fingerprint = fingerprint(raw);
        if state.completed.contains(&fingerprint) {
            return Err(HttpError::new(409, "retrieval_already_recorded", false));
        }
        if state.completed.len() >= 64 {
            return Err(HttpError::new(503, "retrieval_turn_limit", false));
        }
        match request.operation {
            Operation::MemoryQuery => {
                let staged = match state.staged.take() {
                    Some(entry) if entry.0 == fingerprint => Some(entry),
                    Some(_) => {
                        let _ = instance.cancel_retrieval(&state.session);
                        None
                    }
                    None => None,
                };
                let (search_id, prepared) = if let Some((_, search_id, prepared)) = staged {
                    if instance
                        .preview_retrieval(&state.session, &prepared)
                        .is_ok()
                    {
                        (search_id, prepared)
                    } else {
                        // A new owner cut landed after prefetch. Cancel that
                        // proposal and evaluate against the current cut.
                        let _ = instance.cancel_retrieval(&state.session);
                        state.session = instance
                            .begin_retrieval(owner, &root_turn_id(&key), RetrievalMode::Deliver)
                            .map_err(product_error)?;
                        let outcome = instance
                            .memory_query(&state.session, text_arg(request, "query")?, &runtime)
                            .map_err(product_error)?;
                        let Some(prepared) = outcome.prepared else {
                            return Err(HttpError::new(503, "no_recall_results", false));
                        };
                        (mint_id()?, prepared)
                    }
                } else {
                    let outcome = instance
                        .memory_query(&state.session, text_arg(request, "query")?, &runtime)
                        .map_err(product_error)?;
                    let Some(prepared) = outcome.prepared else {
                        return Err(HttpError::new(503, "no_recall_results", false));
                    };
                    (mint_id()?, prepared)
                };
                Self::return_prepared(
                    request,
                    instance,
                    registry_mutex,
                    owner,
                    sources_mutex,
                    runtimes_mutex,
                    &state.session,
                    prepared,
                    search_id,
                    &mut state.last_search_id,
                    &mut state.last_cut,
                    &mut state.last_ids,
                    &mut state.last_delivery_id,
                    &mut state.completed,
                    fingerprint,
                    deadline,
                )
            }
            Operation::RefineQuery => {
                let supplied_search = request.arguments["search_id"].as_str().ok_or(INVALID)?;
                if state.last_search_id.as_deref() != Some(supplied_search) {
                    return Err(HttpError::new(409, "retrieval_search_stale", false));
                }
                validate_selected_ids(&request.arguments["selected_ids"], &state.last_ids)?;
                let outcome = instance
                    .refine_query(&state.session, text_arg(request, "query")?, &runtime)
                    .map_err(product_error)?;
                let Some(prepared) = outcome.prepared else {
                    return Err(HttpError::new(503, "no_recall_results", false));
                };
                Self::return_prepared(
                    request,
                    instance,
                    registry_mutex,
                    owner,
                    sources_mutex,
                    runtimes_mutex,
                    &state.session,
                    prepared,
                    supplied_search.to_owned(),
                    &mut state.last_search_id,
                    &mut state.last_cut,
                    &mut state.last_ids,
                    &mut state.last_delivery_id,
                    &mut state.completed,
                    fingerprint,
                    deadline,
                )
            }
            Operation::TraverseGraph => {
                let supplied_cut = request.arguments["cut"].as_str().ok_or(INVALID)?;
                if state.last_cut.as_deref() != Some(supplied_cut) {
                    return Err(HttpError::new(409, "retrieval_cut_stale", false));
                }
                if request.arguments["depth"].as_u64() != Some(1) {
                    return Err(HttpError::new(501, "traversal_depth_unsupported", false));
                }
                let seeds = string_array(&request.arguments["seed_ids"])?;
                validate_selected_ids(&request.arguments["seed_ids"], &state.last_ids)?;
                let anchors = seeds
                    .into_iter()
                    .map(parse_memory_id)
                    .collect::<Result<Vec<_>, _>>()?;
                let outcome = instance
                    .traverse_graph(&state.session, &anchors, &runtime)
                    .map_err(product_error)?;
                let Some(prepared) = outcome.prepared else {
                    return Err(HttpError::new(503, "no_recall_results", false));
                };
                Self::return_prepared(
                    request,
                    instance,
                    registry_mutex,
                    owner,
                    sources_mutex,
                    runtimes_mutex,
                    &state.session,
                    prepared,
                    mint_id()?,
                    &mut state.last_search_id,
                    &mut state.last_cut,
                    &mut state.last_ids,
                    &mut state.last_delivery_id,
                    &mut state.completed,
                    fingerprint,
                    deadline,
                )
            }
            _ => Err(INVALID),
        }
    }

    fn return_prepared(
        request: &ProviderRequest,
        instance: &Instance,
        registry_mutex: &Mutex<Registry>,
        owner: OwnerId,
        sources_mutex: &Mutex<SourceService>,
        runtimes_mutex: &Mutex<RuntimeRegistry>,
        session: &RetrievalSession,
        prepared: reliquary_memory::PreparedMemoryDelivery,
        search_id: String,
        last_search_id: &mut Option<String>,
        last_cut: &mut Option<String>,
        last_ids: &mut Vec<String>,
        last_delivery_id: &mut Option<String>,
        completed: &mut BTreeSet<String>,
        request_fingerprint: String,
        deadline: Instant,
    ) -> Result<Value, HttpError> {
        let registry = match registry_mutex.lock() {
            Ok(registry) => registry,
            Err(_) => {
                let _ = instance.cancel_retrieval(session);
                return Err(UNAVAILABLE);
            }
        };
        let selected = match SelectedReturn::new(registry.admission(), instance, session, &prepared)
        {
            Ok(selected) => selected,
            Err(error) => {
                let _ = instance.cancel_retrieval(session);
                return Err(product_error(error));
            }
        };
        let selection = selected.selection().clone();
        if let Err(error) = validate_projection(&selection, request_limit(request)?)
            .and_then(|()| validate_requested_cut(request, &selection))
        {
            let _ = instance.cancel_retrieval(session);
            return Err(error);
        }
        let sources = match sources_mutex.lock() {
            Ok(sources) => sources,
            Err(_) => {
                let _ = instance.cancel_retrieval(session);
                return Err(UNAVAILABLE);
            }
        };
        let mut runtimes = match runtimes_mutex.lock() {
            Ok(runtimes) => runtimes,
            Err(_) => {
                let _ = instance.cancel_retrieval(session);
                return Err(UNAVAILABLE);
            }
        };
        let provenance = match sources.retrieval_provenance(
            instance,
            &registry,
            &mut runtimes,
            owner,
            &selection,
        ) {
            Ok(provenance) => provenance,
            Err(error) => {
                let _ = instance.cancel_retrieval(session);
                return Err(error);
            }
        };
        let context = selection
            .memories
            .iter()
            .map(|memory| memory.content.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        if context.len() > 32768 {
            let _ = instance.cancel_retrieval(session);
            return Err(HttpError::new(503, "retrieval_projection_exceeded", false));
        }
        let cut = cut_token(&selection)?;
        if Instant::now() >= deadline {
            let _ = instance.cancel_retrieval(session);
            return Err(UNAVAILABLE);
        }
        match selected.return_selected().map_err(product_error)? {
            ReturnOutcome::Returned {
                delivery_id,
                selection,
            } => {
                // The shim returns the same immutable Root selection checked
                // above, after the accepted-use receipt has been recorded.
                let ids = selection
                    .memories
                    .iter()
                    .map(|memory| memory.memory_id.clone())
                    .collect::<Vec<_>>();
                *last_search_id = Some(search_id.clone());
                *last_cut = Some(cut.clone());
                *last_ids = ids.clone();
                *last_delivery_id = Some(delivery_id.to_owned());
                completed.insert(request_fingerprint);
                Ok(json!({
                        "protocol_version": 1,
                        "request_id": request.retrieval_request_id(),
                        "operation": request.operation,
                        "status": "ok",
                        "revision": null,
                        "cut": cut,
                        "result": {
                            "search_id": search_id,
                            "delivery_id": delivery_id,
                            "context": context,
                            "memory_ids": ids,
                            "provenance": provenance,
                        }
                }))
            }
            ReturnOutcome::AlreadyRecorded => {
                Err(HttpError::new(409, "retrieval_already_recorded", false))
            }
        }
    }

    fn turn_mut<'a>(
        &'a mut self,
        key: &TurnKey,
        instance: &Instance,
        owner: OwnerId,
    ) -> Result<&'a mut TurnState, HttpError> {
        if !self.turns.contains_key(key) {
            self.runtime.as_ref().ok_or(UNAVAILABLE)?;
            let session = instance
                .begin_retrieval(owner, &root_turn_id(key), RetrievalMode::Deliver)
                .map_err(product_error)?;
            if self.turns.len() >= MAX_TURNS {
                if let Some(oldest) = self
                    .turns
                    .iter()
                    .min_by_key(|(_, state)| state.touched)
                    .map(|(key, _)| key.clone())
                {
                    if let Some(old) = self.turns.remove(&oldest) {
                        if old.staged.is_some() {
                            let _ = instance.cancel_retrieval(&old.session);
                        }
                    }
                }
            }
            self.turns.insert(
                key.clone(),
                TurnState {
                    session,
                    last_search_id: None,
                    last_cut: None,
                    last_ids: Vec::new(),
                    last_delivery_id: None,
                    staged: None,
                    completed: BTreeSet::new(),
                    touched: Instant::now(),
                },
            );
        }
        self.turns.get_mut(key).ok_or(UNAVAILABLE)
    }

    fn prune(&mut self, instance: &Instance) {
        let now = Instant::now();
        self.turns.retain(|_, state| {
            let keep = now.duration_since(state.touched) <= TURN_TTL;
            if !keep && state.staged.is_some() {
                let _ = instance.cancel_retrieval(&state.session);
            }
            keep
        });
    }
}

pub(crate) fn no_dashboard_recall() -> Value {
    json!({"state": "none", "search_id": null, "delivery_id": null,
        "candidate_ids": [], "selected_ids": [], "returned_ids": []})
}

fn turn_key(request: &ProviderRequest) -> TurnKey {
    let (profile, principal, session, turn) = request.retrieval_scope();
    (
        profile.into(),
        principal.into(),
        session.into(),
        turn.into(),
    )
}

fn root_turn_id(key: &TurnKey) -> String {
    let mut hash = Sha256::new();
    for part in [&key.0, &key.1, &key.2, &key.3] {
        hash.update((part.len() as u64).to_le_bytes());
        hash.update(part.as_bytes());
    }
    format!("hermes-{}", hex(&hash.finalize()))
}

fn fingerprint(raw: &[u8]) -> String {
    hex(&Sha256::digest(raw))
}

fn cut_token(selection: &RetrievalPreview) -> Result<String, HttpError> {
    let bytes = serde_json::to_vec(&selection.cut).map_err(|_| UNAVAILABLE)?;
    Ok(hex(&Sha256::digest(bytes)))
}

fn validate_requested_cut(
    request: &ProviderRequest,
    selection: &RetrievalPreview,
) -> Result<(), HttpError> {
    if request.operation == Operation::TraverseGraph
        && request.arguments["cut"].as_str() != Some(cut_token(selection)?.as_str())
    {
        return Err(HttpError::new(409, "retrieval_cut_stale", false));
    }
    Ok(())
}

fn validate_projection(selection: &RetrievalPreview, limit: usize) -> Result<(), HttpError> {
    if selection.truncated
        || selection.memories.iter().any(|memory| memory.truncated)
        || selection.memories.len() > limit
    {
        return Err(HttpError::new(503, "retrieval_projection_exceeded", false));
    }
    Ok(())
}

fn request_limit(request: &ProviderRequest) -> Result<usize, HttpError> {
    request.arguments["limit"]
        .as_u64()
        .and_then(|value| usize::try_from(value).ok())
        .ok_or(INVALID)
}

fn text_arg<'a>(request: &'a ProviderRequest, key: &str) -> Result<&'a str, HttpError> {
    request.arguments[key].as_str().ok_or(INVALID)
}

fn string_array(value: &Value) -> Result<Vec<String>, HttpError> {
    value
        .as_array()
        .ok_or(INVALID)?
        .iter()
        .map(|item| item.as_str().map(str::to_owned).ok_or(INVALID))
        .collect()
}

fn validate_selected_ids(value: &Value, available: &[String]) -> Result<(), HttpError> {
    if string_array(value)?
        .iter()
        .any(|id| !available.contains(id))
    {
        return Err(HttpError::new(409, "retrieval_selection_stale", false));
    }
    Ok(())
}

fn parse_memory_id(value: String) -> Result<MemoryId, HttpError> {
    if value.len() != 64 {
        return Err(INVALID);
    }
    let mut bytes = [0u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let digit = |byte: u8| match byte {
            b'0'..=b'9' => byte - b'0',
            b'a'..=b'f' => byte - b'a' + 10,
            b'A'..=b'F' => byte - b'A' + 10,
            _ => 255,
        };
        let high = digit(pair[0]);
        let low = digit(pair[1]);
        if high > 15 || low > 15 {
            return Err(INVALID);
        }
        bytes[index] = (high << 4) | low;
    }
    Ok(MemoryId(bytes))
}

fn mint_id() -> Result<String, HttpError> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| UNAVAILABLE)?;
    Ok(hex(&bytes))
}

fn product_error(error: reliquary_memory::ProductError) -> HttpError {
    use reliquary_memory::ProductErrorKind;
    match error.kind() {
        ProductErrorKind::InvalidInput | ProductErrorKind::WrongFormat => INVALID,
        ProductErrorKind::Unauthorized | ProductErrorKind::Revoked => {
            HttpError::new(403, "denied", false)
        }
        ProductErrorKind::Conflict | ProductErrorKind::WriterUnavailable => {
            HttpError::new(409, "retrieval_conflict", false)
        }
        _ => UNAVAILABLE,
    }
}
