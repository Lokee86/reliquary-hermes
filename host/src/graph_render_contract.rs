use serde::Serialize;

pub(crate) const GRAPH_RENDER_MANIFEST_SCHEMA_VERSION: u16 = 3;
pub(crate) type GraphRenderVec3 = [f32; 3];

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRenderBounds {
    pub(crate) min: [f32; 3],
    pub(crate) max: [f32; 3],
}

impl GraphRenderBounds {
    pub(crate) const fn new(min: [f32; 3], max: [f32; 3]) -> Self {
        Self { min, max }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphRenderHierarchyKind {
    Graph,
    Territory,
    Subgroup,
    Leaf,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRenderHierarchyDescriptor {
    pub(crate) id: u32,
    pub(crate) parent_id: Option<u32>,
    pub(crate) kind: GraphRenderHierarchyKind,
    pub(crate) bounds: GraphRenderBounds,
    pub(crate) node_count: u32,
    pub(crate) chunk_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) territory: Option<GraphRenderTerritory>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum GraphRenderTerritoryKind {
    Community,
    Unassigned,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphRenderTerritory {
    pub(crate) kind: GraphRenderTerritoryKind,
    pub(crate) community_id: Option<String>,
    pub(crate) label: String,
    pub(crate) color: [f32; 3],
    pub(crate) center: [f32; 3],
    pub(crate) radius: f32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRenderLabelCandidateDescriptor {
    pub(crate) render_id: u32,
    pub(crate) item_index: u32,
    pub(crate) importance: u32,
    pub(crate) label: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRenderNodeChunkDescriptor {
    pub(crate) chunk_id: u32,
    pub(crate) parent_hierarchy_id: u32,
    pub(crate) bounds: GraphRenderBounds,
    pub(crate) node_count: u32,
    pub(crate) byte_len: u32,
    pub(crate) label_candidates: Vec<GraphRenderLabelCandidateDescriptor>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphRenderEdgeLod {
    Overview,
    Intermediate,
    Detail,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRenderEdgeChunkDescriptor {
    pub(crate) chunk_id: u32,
    pub(crate) lod: GraphRenderEdgeLod,
    pub(crate) bounds: GraphRenderBounds,
    pub(crate) segment_count: u32,
    pub(crate) byte_len: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRenderManifest {
    pub(crate) schema_version: u16,
    pub(crate) generation_id: String,
    pub(crate) owner_id: String,
    pub(crate) source_community_generation: Option<String>,
    pub(crate) total_node_count: u32,
    pub(crate) root_hierarchy_id: u32,
    pub(crate) global_bounds: GraphRenderBounds,
    pub(crate) hierarchy: Vec<GraphRenderHierarchyDescriptor>,
    pub(crate) node_chunks: Vec<GraphRenderNodeChunkDescriptor>,
    pub(crate) edge_chunks: Vec<GraphRenderEdgeChunkDescriptor>,
}

pub(crate) fn decimal_u64(value: u64) -> String {
    value.to_string()
}
