use crate::graph_render_contract::GraphRenderHierarchyKind;
use crate::graph_render_identity::RenderNodeId;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct GraphRenderHierarchy {
    pub(crate) nodes: Vec<GraphRenderHierarchyNode>,
    pub(crate) leaves: Vec<GraphRenderLeaf>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct GraphRenderHierarchyNode {
    pub(crate) id: u32,
    pub(crate) parent_id: Option<u32>,
    pub(crate) kind: GraphRenderHierarchyKind,
    pub(crate) node_count: u32,
    pub(crate) source_community_id: Option<[u8; 32]>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct GraphRenderLeaf {
    pub(crate) hierarchy_id: u32,
    pub(crate) chunk_id: u32,
    pub(crate) render_ids: Vec<RenderNodeId>,
}
