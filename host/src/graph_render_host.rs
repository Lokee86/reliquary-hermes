//! Profile-authenticated HTTP boundary for the Warlock-compatible renderer.
#[path = "graph_render_root_projection.rs"]
mod root_projection;

use self::root_projection::{GraphInspection, read_source};
use crate::{
    graph_render::GraphRenderService,
    graph_render_contract::GraphRenderVec3,
    graph_render_identity::{GraphRenderNodeKey, RenderNodeId},
    registry::{Registry, RegistryError},
    service_http::{
        FORBIDDEN, HttpError, HttpResponse, INVALID, MAX_GRAPH_CHUNK_BYTES,
        MAX_GRAPH_MANIFEST_BYTES, UNAVAILABLE,
    },
    service_protocol::decode,
};
use reliquary_memory::{
    InspectionCut, Instance, MemoryId, MemoryListFilters, MemoryListLifecycle, OwnerId, OwnerKind,
    ProductError, ProductErrorKind,
};
use serde::Deserialize;
use serde_json::json;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const GENERATION_TTL: Duration = Duration::from_secs(300);
const MAX_CACHED_CHUNK_BYTES: usize = 512 * 1024 * 1024;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct FilterScope {
    include_archived: bool,
    query: Option<String>,
    community_id: Option<String>,
    category: Option<String>,
    memory_type: Option<String>,
}

impl FilterScope {
    fn root_filters(self) -> Result<MemoryListFilters, HttpError> {
        let query = self.query.unwrap_or_default();
        if query.len() > 4096
            || [&self.category, &self.memory_type]
                .into_iter()
                .flatten()
                .any(|value| value.trim().is_empty() || value.len() > 128)
        {
            return Err(INVALID);
        }
        Ok(MemoryListFilters {
            query: query.trim().to_owned(),
            category: self.category,
            memory_type: self.memory_type,
            lifecycle: (!self.include_archived).then_some(MemoryListLifecycle::Active),
            community_id: self
                .community_id
                .as_deref()
                .map(decode_memory_id)
                .transpose()?
                .map(|id| id.0),
        })
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RenderRequest {
    owner_id: String,
    principal_id: String,
    generation: String,
    cut: String,
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    filters: Option<FilterScope>,
    #[serde(default)]
    memory_id: Option<String>,
    #[serde(default)]
    generation_id: Option<String>,
    #[serde(default)]
    chunk_id: Option<u32>,
    #[serde(default)]
    render_id: Option<u32>,
}

impl RenderRequest {
    fn valid_for(&self, operation: &str) -> bool {
        let bounded = |value: &str, max: usize| !value.is_empty() && value.len() <= max;
        if !bounded(&self.owner_id, 128)
            || !bounded(&self.principal_id, 128)
            || !bounded(&self.generation, 39)
            || !self.generation.bytes().all(|byte| byte.is_ascii_digit())
            || self.cut.len() != 64
            || !self
                .cut
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return false;
        }
        if self
            .session_id
            .as_deref()
            .is_some_and(|id| !bounded(id, 128))
        {
            return false;
        }
        let has_generation = self.generation_id.as_deref().is_some_and(valid_u64_decimal);
        let has_memory = self
            .memory_id
            .as_deref()
            .is_some_and(|id| decode_memory_id(id).is_ok());
        match operation {
            "prepare" => {
                self.filters.is_some()
                    && self.generation_id.is_none()
                    && self.chunk_id.is_none()
                    && self.render_id.is_none()
                    && self.memory_id.is_none()
            }
            "eligible" => {
                self.filters.is_some()
                    && has_memory
                    && self.generation_id.is_none()
                    && self.chunk_id.is_none()
                    && self.render_id.is_none()
            }
            "node-chunk" | "edge-chunk" => {
                has_generation
                    && self.filters.is_none()
                    && self.chunk_id.is_some()
                    && self.render_id.is_none()
                    && self.memory_id.is_none()
            }
            "resolve" | "inspect" | "neighborhood" => {
                has_generation
                    && self.filters.is_none()
                    && self.chunk_id.is_none()
                    && self.render_id.is_some()
                    && self.memory_id.is_none()
            }
            "locate" => {
                has_generation
                    && self.filters.is_none()
                    && has_memory
                    && self.chunk_id.is_none()
                    && self.render_id.is_none()
            }
            _ => false,
        }
    }
}

struct Authority {
    owner_id: String,
    principal_id: String,
    session_id: Option<String>,
    filters: MemoryListFilters,
    root_generation: String,
    root_cut: String,
    render_generation: u64,
    prepared_at: Instant,
}

#[derive(Default)]
pub(crate) struct GraphRenderHost {
    renderer: GraphRenderService,
    authority: Option<Authority>,
    inspection: GraphInspection,
}

impl GraphRenderHost {
    pub(crate) fn handle(
        &mut self,
        operation: &str,
        instance: &Instance,
        registry: &Mutex<Registry>,
        bytes: &[u8],
    ) -> Result<HttpResponse, HttpError> {
        let request: RenderRequest = decode(bytes).map_err(|_| INVALID)?;
        if !request.valid_for(operation) {
            return Err(INVALID);
        }
        let registry = registry.lock().map_err(|_| UNAVAILABLE)?;
        let (owner, kind, _) = registry
            .dashboard_scope(
                &registry.profile_id().to_owned(),
                &request.principal_id,
                &request.owner_id,
                request.session_id.as_deref(),
            )
            .map_err(registry_error)?;
        drop(registry);

        match operation {
            "prepare" => self.prepare(instance, owner, kind, request),
            "eligible" => {
                let cut = current_cut(instance, owner, kind)?;
                let (generation, binding) = cut_binding(&cut);
                if request.generation != generation || request.cut != binding {
                    return Err(HttpError::new(409, "owner_cut_changed", false));
                }
                let filters = request.filters.ok_or(INVALID)?.root_filters()?;
                let id = decode_memory_id(request.memory_id.as_deref().ok_or(INVALID)?)?;
                let eligible = instance
                    .memory_matches_filter(owner, kind, cut, &filters, id)
                    .map_err(product_error)?;
                Ok(HttpResponse::ok(json!({ "eligible": eligible })))
            }
            _ => {
                self.authorize_current_cut(instance, owner, kind, &request)?;
                match operation {
                    "node-chunk" => self.node_chunk(&request),
                    "edge-chunk" => self.edge_chunk(&request),
                    "resolve" => self.resolve(&request),
                    "inspect" => self.inspect(&request),
                    "neighborhood" => self.neighborhood(&request),
                    "locate" => self.locate(&request),
                    _ => Err(INVALID),
                }
            }
        }
    }

    fn prepare(
        &mut self,
        instance: &Instance,
        owner: OwnerId,
        kind: OwnerKind,
        request: RenderRequest,
    ) -> Result<HttpResponse, HttpError> {
        let filters = request.filters.clone().ok_or(INVALID)?.root_filters()?;
        let cut = current_cut(instance, owner, kind)?;
        let (root_generation, root_cut) = cut_binding(&cut);
        if request.generation != root_generation || request.cut != root_cut {
            self.evict_if_authority_cut_advanced(&request.owner_id, &root_generation, &root_cut);
            return Err(HttpError::new(409, "owner_cut_changed", false));
        }

        if let Some(authority) = self.authority.as_ref() {
            if authority.prepared_at.elapsed() > GENERATION_TTL {
                self.evict();
            } else if authority.owner_id == request.owner_id
                && authority.principal_id == request.principal_id
                && authority.session_id == request.session_id
                && authority.filters == filters
                && authority.root_generation == root_generation
                && authority.root_cut == root_cut
            {
                let manifest = self
                    .renderer
                    .manifest(authority.render_generation)
                    .map_err(|_| stale_generation())?;
                let body = serde_json::to_value(manifest).map_err(|_| UNAVAILABLE)?;
                return Ok(HttpResponse::graph_manifest(body));
            }
        }

        let (source, inspection) = match read_source(instance, owner, kind, cut, &filters) {
            Ok(source) => source,
            Err(error) => {
                if let Ok(latest_cut) = current_cut(instance, owner, kind) {
                    let (latest_generation, latest_cut) = cut_binding(&latest_cut);
                    self.evict_if_authority_cut_advanced(
                        &request.owner_id,
                        &latest_generation,
                        &latest_cut,
                    );
                }
                return Err(error);
            }
        };
        let latest_cut = current_cut(instance, owner, kind)?;
        if latest_cut != cut {
            let (latest_generation, latest_cut) = cut_binding(&latest_cut);
            self.evict_if_authority_cut_advanced(
                &request.owner_id,
                &latest_generation,
                &latest_cut,
            );
            return Err(HttpError::new(409, "owner_cut_changed", false));
        }

        // A service instance is profile scoped. Keep one prepared generation resident;
        // owner switches and changed cuts retire every earlier render identity.
        if self
            .authority
            .as_ref()
            .is_some_and(|authority| authority.owner_id != request.owner_id)
        {
            self.evict();
        }
        let summary = self.renderer.prepare(source).map_err(|_| UNAVAILABLE)?;
        let latest_cut = match current_cut(instance, owner, kind) {
            Ok(cut) => cut,
            Err(error) => {
                self.evict();
                return Err(error);
            }
        };
        if latest_cut != cut {
            self.evict();
            return Err(HttpError::new(409, "owner_cut_changed", false));
        }
        if self
            .renderer
            .resident_bytes(summary.generation_id)
            .map_err(|_| UNAVAILABLE)?
            > MAX_CACHED_CHUNK_BYTES
        {
            self.evict();
            return Err(HttpError::new(413, "graph_generation_limit", false));
        }
        let manifest = self
            .renderer
            .manifest(summary.generation_id)
            .map_err(|_| UNAVAILABLE)?;
        let body = serde_json::to_value(manifest).map_err(|_| UNAVAILABLE)?;
        if serde_json::to_vec(&body).map_err(|_| UNAVAILABLE)?.len() > MAX_GRAPH_MANIFEST_BYTES {
            self.evict();
            return Err(HttpError::new(413, "graph_manifest_limit", false));
        }
        self.inspection = inspection;
        self.authority = Some(Authority {
            owner_id: request.owner_id,
            principal_id: request.principal_id,
            session_id: request.session_id,
            filters,
            root_generation,
            root_cut,
            render_generation: summary.generation_id,
            prepared_at: Instant::now(),
        });
        Ok(HttpResponse::graph_manifest(body))
    }

    fn authorize_current_cut(
        &mut self,
        instance: &Instance,
        owner: OwnerId,
        kind: OwnerKind,
        request: &RenderRequest,
    ) -> Result<(), HttpError> {
        let authority = self.authority.as_ref().ok_or_else(stale_generation)?;
        if authority.prepared_at.elapsed() > GENERATION_TTL {
            self.evict();
            return Err(stale_generation());
        }
        if authority.owner_id != request.owner_id
            || authority.principal_id != request.principal_id
            || authority.session_id != request.session_id
        {
            return Err(stale_generation());
        }
        let current = current_cut(instance, owner, kind)?;
        let (generation, cut) = cut_binding(&current);
        if authority.root_generation != generation || authority.root_cut != cut {
            self.evict();
            return Err(stale_generation());
        }
        if request.generation != generation || request.cut != cut {
            return Err(stale_generation());
        }
        Ok(())
    }

    fn node_chunk(&mut self, request: &RenderRequest) -> Result<HttpResponse, HttpError> {
        let generation_id = self.check_render_generation(request)?;
        let chunk_id = request.chunk_id.ok_or(INVALID)?;
        let bytes = self
            .renderer
            .node_chunk(generation_id, chunk_id)
            .map_err(|_| stale_generation())?;
        if bytes.len() > MAX_GRAPH_CHUNK_BYTES {
            return Err(HttpError::new(413, "graph_chunk_limit", false));
        }
        Ok(HttpResponse::binary(bytes.to_vec()))
    }

    fn edge_chunk(&mut self, request: &RenderRequest) -> Result<HttpResponse, HttpError> {
        let generation_id = self.check_render_generation(request)?;
        let chunk_id = request.chunk_id.ok_or(INVALID)?;
        let bytes = self
            .renderer
            .edge_chunk(generation_id, chunk_id)
            .map_err(|_| stale_generation())?;
        if bytes.len() > MAX_GRAPH_CHUNK_BYTES {
            return Err(HttpError::new(413, "graph_chunk_limit", false));
        }
        Ok(HttpResponse::binary(bytes.to_vec()))
    }

    fn resolve(&self, request: &RenderRequest) -> Result<HttpResponse, HttpError> {
        let generation = self.check_render_generation(request)?;
        let id = RenderNodeId::new(request.render_id.ok_or(INVALID)?);
        let memory = self.memory_id(generation, id)?;
        Ok(HttpResponse::ok(json!({"memoryId": memory})))
    }

    fn inspect(&self, request: &RenderRequest) -> Result<HttpResponse, HttpError> {
        let generation = self.check_render_generation(request)?;
        let id = RenderNodeId::new(request.render_id.ok_or(INVALID)?);
        let memory = self.memory_id(generation, id)?;
        let title = self
            .inspection
            .titles
            .get(id.get() as usize)
            .and_then(Option::as_deref)
            .ok_or_else(|| HttpError::new(404, "graph_title_unavailable", false))?;
        let position = self.positions(generation)?[id.get() as usize];
        Ok(HttpResponse::ok(
            json!({"memoryId": memory, "title": title, "position": position}),
        ))
    }

    fn locate(&self, request: &RenderRequest) -> Result<HttpResponse, HttpError> {
        let generation = self.check_render_generation(request)?;
        let memory = decode_memory_id(request.memory_id.as_deref().ok_or(INVALID)?)?;
        let key = GraphRenderNodeKey::new(memory.0.to_vec());
        let id = self
            .renderer
            .locate_node(generation, &key)
            .map_err(|_| stale_generation())?;
        let Some(id) = id else {
            return Ok(HttpResponse::ok(serde_json::Value::Null));
        };
        let position = self.positions(generation)?[id.get() as usize];
        Ok(HttpResponse::ok(
            json!({"renderId": id.get(), "position": position}),
        ))
    }

    fn neighborhood(&self, request: &RenderRequest) -> Result<HttpResponse, HttpError> {
        let generation = self.check_render_generation(request)?;
        let id = request.render_id.ok_or(INVALID)?;
        let neighborhood = self
            .inspection
            .incident
            .neighborhood(id, self.positions(generation)?)
            .ok_or_else(stale_generation)?;
        Ok(HttpResponse::ok(
            serde_json::to_value(neighborhood).map_err(|_| UNAVAILABLE)?,
        ))
    }

    fn positions(&self, generation: u64) -> Result<&[GraphRenderVec3], HttpError> {
        Ok(&self
            .renderer
            .layout(generation)
            .map_err(|_| stale_generation())?
            .positions)
    }

    fn memory_id(&self, generation: u64, id: RenderNodeId) -> Result<String, HttpError> {
        let target = self
            .renderer
            .resolve_node(generation, id)
            .map_err(|_| stale_generation())?;
        if target.kind != "memory" || target.value.len() != 32 {
            return Err(HttpError::new(409, "graph_selection_unavailable", false));
        }
        Ok(hex(&target.value))
    }

    fn check_render_generation(&self, request: &RenderRequest) -> Result<u64, HttpError> {
        let authority = self.authority.as_ref().ok_or_else(stale_generation)?;
        let requested = request
            .generation_id
            .as_deref()
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or(INVALID)?;
        if requested != authority.render_generation
            || authority.prepared_at.elapsed() > GENERATION_TTL
        {
            return Err(stale_generation());
        }
        Ok(requested)
    }

    fn evict(&mut self) {
        self.renderer.clear();
        self.authority = None;
        self.inspection = GraphInspection::default();
    }

    fn evict_if_authority_cut_advanced(
        &mut self,
        owner_id: &str,
        current_generation: &str,
        current_cut: &str,
    ) {
        let should_evict = self.authority.as_ref().is_some_and(|authority| {
            authority.owner_id == owner_id
                && (authority.root_generation != current_generation
                    || authority.root_cut != current_cut)
        });
        if should_evict {
            self.evict();
        }
    }

    pub(crate) fn expire(&mut self) {
        if self
            .authority
            .as_ref()
            .is_some_and(|authority| authority.prepared_at.elapsed() > GENERATION_TTL)
        {
            self.evict();
        }
    }
}

fn current_cut(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
) -> Result<InspectionCut, HttpError> {
    instance
        .semantic_graph_inspection_cut(owner, kind)
        .map_err(product_error)
}

fn cut_binding(cut: &InspectionCut) -> (String, String) {
    (
        crate::dashboard::generation_id(cut),
        crate::dashboard::cut_id(cut),
    )
}

fn decode_memory_id(value: &str) -> Result<MemoryId, HttpError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(INVALID);
    }
    let mut bytes = [0; 32];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).map_err(|_| INVALID)?;
    }
    Ok(MemoryId(bytes))
}

fn product_error(error: ProductError) -> HttpError {
    match error.kind() {
        ProductErrorKind::Unauthorized | ProductErrorKind::Revoked => FORBIDDEN,
        ProductErrorKind::Stale => HttpError::new(409, "owner_cut_changed", false),
        ProductErrorKind::InvalidInput => INVALID,
        ProductErrorKind::Conflict => HttpError::new(409, "owner_conflict", false),
        _ => UNAVAILABLE,
    }
}

fn registry_error(error: RegistryError) -> HttpError {
    match error {
        RegistryError::Invalid(_) => INVALID,
        RegistryError::Denied(_) => FORBIDDEN,
        RegistryError::Conflict(_) => HttpError::new(409, "owner_conflict", false),
        RegistryError::Unavailable(_) => UNAVAILABLE,
    }
}

fn stale_generation() -> HttpError {
    HttpError::new(409, "graph_generation_stale", false)
}

fn valid_u64_decimal(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 20
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && value.parse::<u64>().is_ok()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn authority(owner_id: &str) -> Authority {
        Authority {
            owner_id: owner_id.to_owned(),
            principal_id: "principal".into(),
            session_id: None,
            filters: MemoryListFilters::default(),
            root_generation: "17".to_owned(),
            root_cut: "cut-a".to_owned(),
            render_generation: 9,
            prepared_at: Instant::now(),
        }
    }

    #[test]
    fn stale_selectors_do_not_evict_a_different_live_generation() {
        let mut host = GraphRenderHost {
            renderer: GraphRenderService::default(),
            authority: Some(authority("owner-a")),
            inspection: GraphInspection::default(),
        };
        host.evict_if_authority_cut_advanced("owner-b", "18", "cut-b");
        assert!(host.authority.is_some());

        let request = RenderRequest {
            owner_id: "owner-a".into(),
            principal_id: "principal".into(),
            generation: "17".into(),
            cut: "cut-a".into(),
            session_id: None,
            filters: None,
            memory_id: None,
            generation_id: Some("8".into()),
            chunk_id: Some(0),
            render_id: None,
        };
        assert!(host.check_render_generation(&request).is_err());
        assert_eq!(host.authority.as_ref().unwrap().render_generation, 9);
    }

    #[test]
    fn authority_cut_advance_and_ttl_expire_resident_generation() {
        let mut host = GraphRenderHost {
            renderer: GraphRenderService::default(),
            authority: Some(authority("owner-a")),
            inspection: GraphInspection::default(),
        };
        host.evict_if_authority_cut_advanced("owner-a", "18", "cut-b");
        assert!(host.authority.is_none());

        let mut expired = authority("owner-a");
        expired.prepared_at = Instant::now() - GENERATION_TTL - Duration::from_secs(1);
        host.authority = Some(expired);
        host.expire();
        assert!(host.authority.is_none());
    }

    #[test]
    fn requests_accept_only_the_fields_for_the_selected_operation() {
        let mut request = RenderRequest {
            owner_id: "owner".into(),
            principal_id: "principal".into(),
            generation: "17".into(),
            cut: "a".repeat(64),
            session_id: None,
            filters: Some(FilterScope::default()),
            memory_id: None,
            generation_id: None,
            chunk_id: None,
            render_id: None,
        };
        assert!(request.valid_for("prepare"));

        request.chunk_id = Some(0);
        assert!(!request.valid_for("prepare"));
        request.generation_id = Some("9".into());
        request.filters = None;
        assert!(request.valid_for("node-chunk"));
        request.render_id = Some(0);
        assert!(!request.valid_for("node-chunk"));
        request.chunk_id = None;
        assert!(request.valid_for("resolve"));
        request.cut = "A".repeat(64);
        assert!(!request.valid_for("resolve"));
    }
}
