use crate::graph_render_chunk_store::GraphRenderChunkStore;
use crate::graph_render_contract::GraphRenderManifest;
use crate::graph_render_edge_projection_model::GraphRenderEdgeProjection;
use crate::graph_render_hierarchy_model::GraphRenderHierarchy;
use crate::graph_render_identity::{GraphRenderNodeKey, GraphRenderNodeTarget};
use crate::graph_render_layout_model::GraphRenderLayout;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct GraphRenderReuseStats {
    pub(crate) hierarchy_layout_reused: bool,
    pub(crate) node_chunks_reused: u32,
    pub(crate) node_chunks_encoded: u32,
    pub(crate) edge_chunks_reused: u32,
    pub(crate) edge_chunks_encoded: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct GraphRenderGenerationSummary {
    pub(crate) generation_id: u64,
    pub(crate) owner_id: String,
    pub(crate) source_community_generation: Option<u64>,
    pub(crate) node_count: u32,
    pub(crate) reuse: GraphRenderReuseStats,
}

#[derive(Clone, Debug)]
pub(crate) struct GraphRenderGeneration {
    pub(crate) summary: GraphRenderGenerationSummary,
    pub(crate) node_keys: Vec<GraphRenderNodeKey>,
    pub(crate) node_targets: Vec<GraphRenderNodeTarget>,
    pub(crate) hierarchy: GraphRenderHierarchy,
    pub(crate) layout: GraphRenderLayout,
    pub(crate) layout_fingerprint: u64,
    pub(crate) edge_projection: GraphRenderEdgeProjection,
    pub(crate) manifest: GraphRenderManifest,
    pub(crate) chunks: GraphRenderChunkStore,
}
