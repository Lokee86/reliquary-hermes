//! Profile-authenticated HTTP boundary for the Warlock-compatible renderer.
use crate::{
    graph_render::GraphRenderService,
    graph_render_identity::{GraphRenderNodeKey, GraphRenderNodeTarget, RenderNodeId},
    graph_render_source::{
        GraphRenderCommunitySource, GraphRenderNodeSource, GraphRenderRelationSource,
        GraphRenderSource,
    },
    graph_render_source_style::style_for_relation,
    registry::{Registry, RegistryError},
    service_http::{
        FORBIDDEN, HttpError, HttpResponse, INVALID, MAX_GRAPH_CHUNK_BYTES,
        MAX_GRAPH_MANIFEST_BYTES, UNAVAILABLE,
    },
    service_protocol::decode,
};
use reliquary_memory::{
    CommunityId, InspectionCut, Instance, MemoryId, NodeRef, OwnerId, OwnerKind, ProductError,
    ProductErrorKind, Relation, SemanticGraphCut,
};
use serde::Deserialize;
use serde_json::json;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const GENERATION_TTL: Duration = Duration::from_secs(300);
const SOURCE_PAGE_LIMIT: usize = 128;
const MAX_RENDER_NODES: usize = 1_000_000;
const MAX_RENDER_RELATIONS: usize = 10_000_000;
const MAX_CACHED_CHUNK_BYTES: usize = 512 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RenderRequest {
    owner_id: String,
    principal_id: String,
    generation: String,
    cut: String,
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
        match operation {
            "prepare" => {
                self.generation_id.is_none() && self.chunk_id.is_none() && self.render_id.is_none()
            }
            "node-chunk" | "edge-chunk" => {
                self.generation_id.as_deref().is_some_and(valid_u64_decimal)
                    && self.chunk_id.is_some()
                    && self.render_id.is_none()
            }
            "resolve" => {
                self.generation_id.as_deref().is_some_and(valid_u64_decimal)
                    && self.chunk_id.is_none()
                    && self.render_id.is_some()
            }
            _ => false,
        }
    }
}

struct Authority {
    owner_id: String,
    root_generation: String,
    root_cut: String,
    render_generation: u64,
    prepared_at: Instant,
}

#[derive(Default)]
pub(crate) struct GraphRenderHost {
    renderer: GraphRenderService,
    authority: Option<Authority>,
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
                None,
            )
            .map_err(registry_error)?;
        drop(registry);

        match operation {
            "prepare" => self.prepare(instance, owner, kind, request),
            "node-chunk" => {
                self.authorize_current_cut(instance, owner, kind, &request)?;
                self.node_chunk(&request)
            }
            "edge-chunk" => {
                self.authorize_current_cut(instance, owner, kind, &request)?;
                self.edge_chunk(&request)
            }
            "resolve" => {
                self.authorize_current_cut(instance, owner, kind, &request)?;
                self.resolve(&request)
            }
            _ => Err(INVALID),
        }
    }

    fn prepare(
        &mut self,
        instance: &Instance,
        owner: OwnerId,
        kind: OwnerKind,
        request: RenderRequest,
    ) -> Result<HttpResponse, HttpError> {
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

        let (source, source_cut) = match source_for_owner(instance, owner, kind, cut) {
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
        if source_cut != cut {
            return Err(HttpError::new(409, "owner_cut_changed", false));
        }
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
        self.renderer.clear();
        self.authority = None;
        let summary = self.renderer.prepare(source).map_err(|_| UNAVAILABLE)?;
        let latest_cut = match current_cut(instance, owner, kind) {
            Ok(cut) => cut,
            Err(error) => {
                self.renderer.clear();
                return Err(error);
            }
        };
        if latest_cut != cut {
            self.renderer.clear();
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
        self.authority = Some(Authority {
            owner_id: request.owner_id,
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
        if authority.owner_id != request.owner_id {
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

    fn resolve(&mut self, request: &RenderRequest) -> Result<HttpResponse, HttpError> {
        let generation_id = self.check_render_generation(request)?;
        let render_id = RenderNodeId::new(request.render_id.ok_or(INVALID)?);
        let target = self
            .renderer
            .resolve_node(generation_id, render_id)
            .map_err(|_| stale_generation())?;
        if target.kind != "memory" {
            return Err(HttpError::new(409, "graph_selection_unavailable", false));
        }
        let memory_id: [u8; 32] = target
            .value
            .try_into()
            .map_err(|_| HttpError::new(409, "graph_selection_unavailable", false))?;
        Ok(HttpResponse::ok(json!({"memoryId": hex(&memory_id)})))
    }

    fn check_render_generation(&mut self, request: &RenderRequest) -> Result<u64, HttpError> {
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
) -> Result<SemanticGraphCut, HttpError> {
    let (cut, _) = instance
        .semantic_graph_memory_page(owner, kind, None, None, 1)
        .map_err(product_error)?;
    Ok(cut)
}

fn source_for_owner(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    expected_cut: SemanticGraphCut,
) -> Result<(GraphRenderSource, SemanticGraphCut), HttpError> {
    let (cut, first_page) = instance
        .semantic_graph_memory_page(owner, kind, Some(expected_cut), None, SOURCE_PAGE_LIMIT)
        .map_err(product_error)?;
    if cut != expected_cut {
        return Err(HttpError::new(409, "owner_cut_changed", false));
    }
    let mut memories = first_page.memories;
    let mut after = first_page.next;
    while let Some(next) = after {
        if memories.len() >= MAX_RENDER_NODES {
            return Err(HttpError::new(413, "graph_node_limit", false));
        }
        let (page_cut, page) = instance
            .semantic_graph_memory_page(owner, kind, Some(cut), Some(next), SOURCE_PAGE_LIMIT)
            .map_err(product_error)?;
        if page_cut != cut {
            return Err(HttpError::new(409, "owner_cut_changed", false));
        }
        memories.extend(page.memories);
        after = page.next;
    }
    if memories.len() > MAX_RENDER_NODES {
        return Err(HttpError::new(413, "graph_node_limit", false));
    }

    let mut relations = Vec::new();
    let mut offset = 0;
    loop {
        let (page_cut, page) = instance
            .semantic_graph_relation_page(owner, kind, cut, offset, SOURCE_PAGE_LIMIT)
            .map_err(product_error)?;
        if page_cut != cut {
            return Err(HttpError::new(409, "owner_cut_changed", false));
        }
        if relations.len().saturating_add(page.relations.len()) > MAX_RENDER_RELATIONS {
            return Err(HttpError::new(413, "graph_relation_limit", false));
        }
        relations.extend(page.relations);
        match page.next {
            Some(next) if next > offset => offset = next,
            Some(_) => return Err(HttpError::new(503, "graph_source_invalid", false)),
            None => break,
        }
    }
    let community_generation = cut.community;
    let community_sources = community_sources(instance, owner, kind, cut)?;
    let mut nodes = memories
        .into_iter()
        .map(|memory| {
            let key = memory_key(memory.id);
            GraphRenderNodeSource::new(
                key,
                memory.title.unwrap_or_default(),
                GraphRenderNodeTarget::new("memory", memory.id.0.to_vec()),
            )
        })
        .collect::<Vec<_>>();
    nodes.sort_unstable_by(|left, right| left.key.cmp(&right.key));
    for (render_id, node) in nodes.iter_mut().enumerate() {
        node.label = node.label.chars().take(256).collect();
        if node.label.trim().is_empty() {
            node.label = format!("Memory {render_id}");
        }
    }
    let relation_sources = relations
        .into_iter()
        .filter_map(|relation| relation_source(relation))
        .collect();
    let source = GraphRenderSource::new(
        owner.to_string(),
        community_generation,
        nodes,
        relation_sources,
        community_sources,
    );
    Ok((source, cut))
}

fn relation_source(relation: Relation) -> Option<GraphRenderRelationSource> {
    if !relation.active {
        return None;
    }
    let (NodeRef::Memory(source), NodeRef::Memory(target)) = (relation.source, relation.target)
    else {
        return None;
    };
    if matches!(
        relation.kind,
        reliquary_memory::RelationKind::EntityAssociation
            | reliquary_memory::RelationKind::PrincipalAssociation
    ) {
        return None;
    }
    Some(GraphRenderRelationSource {
        source: GraphRenderNodeKey::new(source.to_vec()),
        target: GraphRenderNodeKey::new(target.to_vec()),
        style: style_for_relation(relation.kind, relation.origin),
    })
}

fn community_sources(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    cut: SemanticGraphCut,
) -> Result<Vec<GraphRenderCommunitySource>, HttpError> {
    let mut communities = Vec::new();
    let mut after_community: Option<CommunityId> = None;
    loop {
        let (page_cut, page) = instance
            .semantic_graph_community_page(owner, kind, cut, after_community, SOURCE_PAGE_LIMIT)
            .map_err(product_error)?;
        if page_cut != cut {
            return Err(HttpError::new(409, "owner_cut_changed", false));
        }
        for community in page.communities {
            let mut members = Vec::with_capacity(community.member_count);
            let mut after_member = None;
            loop {
                let (member_cut, page) = instance
                    .semantic_graph_community_member_page(
                        owner,
                        kind,
                        cut,
                        community.id,
                        after_member,
                        SOURCE_PAGE_LIMIT,
                    )
                    .map_err(product_error)?;
                if member_cut != cut {
                    return Err(HttpError::new(409, "owner_cut_changed", false));
                }
                members.extend(page.members.into_iter().map(memory_key));
                after_member = page.next;
                if after_member.is_none() {
                    break;
                }
            }
            if members.len() != community.member_count {
                return Err(HttpError::new(409, "community_cut_mismatch", false));
            }
            communities.push(GraphRenderCommunitySource::new(community.id.0, members));
        }
        match page.next {
            Some(next) if Some(next) != after_community => after_community = Some(next),
            Some(_) => return Err(HttpError::new(503, "community_page_invalid", false)),
            None => break,
        }
    }
    Ok(communities)
}

fn memory_key(id: MemoryId) -> GraphRenderNodeKey {
    GraphRenderNodeKey::new(id.0.to_vec())
}

fn cut_binding(cut: &SemanticGraphCut) -> (String, String) {
    let inspection_cut = InspectionCut {
        owner_id: cut.owner_id,
        generation: cut.generation,
        archive: cut.archive,
        memory: cut.memory,
        perception: cut.perception,
        relationship: cut.relationship,
        graph: cut.graph,
        community: cut.community,
    };
    (
        crate::dashboard::generation_id(&inspection_cut),
        crate::dashboard::cut_id(&inspection_cut),
    )
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
        };
        host.evict_if_authority_cut_advanced("owner-b", "18", "cut-b");
        assert!(host.authority.is_some());

        let request = RenderRequest {
            owner_id: "owner-a".into(),
            principal_id: "principal".into(),
            generation: "17".into(),
            cut: "cut-a".into(),
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
        };
        host.evict_if_authority_cut_advanced("owner-a", "18", "cut-b");
        assert!(host.authority.is_none());

        let mut expired = authority("owner-a");
        expired.prepared_at = Instant::now() - GENERATION_TTL - Duration::from_secs(1);
        host.authority = Some(expired);
        host.expire();
        assert!(host.authority.is_none());
    }
}
