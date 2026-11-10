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
    CommunityId, Instance, MemoryId, NodeRef, OwnerId, OwnerKind, ProductError, ProductErrorKind,
    Relation, SemanticGraphCut,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
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
        let registry = registry.lock().map_err(|_| UNAVAILABLE)?;
        let (owner, kind, _) = registry
            .dashboard_scope(
                &registry.profile_id().to_owned(),
                &request.principal_id,
                &request.owner_id,
                None,
            )
            .map_err(registry_error)?;

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
        let (source, cut) = source_for_owner(instance, owner, kind)?;
        let (root_generation, root_cut) = cut_binding(&cut);
        if request.generation != root_generation || request.cut != root_cut {
            self.evict();
            return Err(HttpError::new(409, "owner_cut_changed", false));
        }

        // A service instance is profile scoped. Keep one prepared generation resident;
        // owner switches and changed cuts retire every earlier render identity.
        self.renderer = GraphRenderService::default();
        self.authority = None;
        let summary = self.renderer.prepare(source).map_err(|_| UNAVAILABLE)?;
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
        if authority.prepared_at.elapsed() > GENERATION_TTL
            || authority.owner_id != request.owner_id
            || authority.root_generation != request.generation
            || authority.root_cut != request.cut
        {
            self.evict();
            return Err(stale_generation());
        }
        let (current, _) = instance
            .semantic_graph_memory_page(owner, kind, None, None, 1)
            .map_err(product_error)?;
        let (generation, cut) = cut_binding(&current);
        if authority.root_generation != generation || authority.root_cut != cut {
            self.evict();
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
            self.evict();
            return Err(stale_generation());
        }
        Ok(requested)
    }

    fn evict(&mut self) {
        self.renderer = GraphRenderService::default();
        self.authority = None;
    }
}

fn source_for_owner(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
) -> Result<(GraphRenderSource, SemanticGraphCut), HttpError> {
    let (cut, first_page) = instance
        .semantic_graph_memory_page(owner, kind, None, None, SOURCE_PAGE_LIMIT)
        .map_err(product_error)?;
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
    let generation =
        u128::from_le_bytes(cut.generation[..16].try_into().expect("fixed generation"));
    #[derive(Serialize)]
    struct CutHashInput {
        owner_id: [u8; 16],
        generation: [u8; 32],
        archive: Option<u64>,
        memory: u64,
        perception: u64,
        relationship: u64,
        graph: u64,
        community: Option<u64>,
    }
    let hash_input = CutHashInput {
        owner_id: cut.owner_id,
        generation: cut.generation,
        archive: cut.archive,
        memory: cut.memory,
        perception: cut.perception,
        relationship: cut.relationship,
        graph: cut.graph,
        community: cut.community,
    };
    let cut_hash = Sha256::digest(serde_json::to_vec(&hash_input).expect("serializable graph cut"));
    (generation.to_string(), crate::service_http::hex(&cut_hash))
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

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
