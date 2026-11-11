use crate::graph_render_error::GraphRenderError;
use crate::graph_render_identity::{GraphRenderNodeKey, GraphRenderNodeTarget};
use crate::graph_render_style::GraphRenderEdgeStyle;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct GraphRenderCommunitySource {
    pub(crate) community_id: [u8; 32],
    pub(crate) members: Vec<GraphRenderNodeKey>,
    pub(crate) name: Option<String>,
}
impl GraphRenderCommunitySource {
    pub(crate) fn new(community_id: [u8; 32], members: Vec<GraphRenderNodeKey>) -> Self {
        Self {
            community_id,
            members,
            name: None,
        }
    }

    pub(crate) fn with_name(mut self, name: Option<String>) -> Self {
        self.name = name;
        self
    }
}
pub(crate) fn reject_duplicate_community_ids(
    communities: &[GraphRenderCommunitySource],
) -> Result<(), GraphRenderError> {
    for pair in communities.windows(2) {
        if pair[0].community_id == pair[1].community_id {
            return Err(GraphRenderError::DuplicateCommunityId(pair[0].community_id));
        }
    }
    Ok(())
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct GraphRenderNodeSource {
    pub(crate) key: GraphRenderNodeKey,
    pub(crate) label: String,
    pub(crate) target: GraphRenderNodeTarget,
}
impl GraphRenderNodeSource {
    pub(crate) fn new(
        key: GraphRenderNodeKey,
        label: impl Into<String>,
        target: GraphRenderNodeTarget,
    ) -> Self {
        Self {
            key,
            label: label.into(),
            target,
        }
    }
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct GraphRenderRelationSource {
    pub(crate) source: GraphRenderNodeKey,
    pub(crate) target: GraphRenderNodeKey,
    pub(crate) style: GraphRenderEdgeStyle,
}
#[derive(Clone, Debug)]
pub(crate) struct GraphRenderSource {
    pub(crate) owner_id: String,
    pub(crate) source_community_generation: Option<u64>,
    pub(crate) nodes: Vec<GraphRenderNodeSource>,
    pub(crate) relations: Vec<GraphRenderRelationSource>,
    pub(crate) communities: Vec<GraphRenderCommunitySource>,
}
impl GraphRenderSource {
    pub(crate) fn new(
        owner_id: impl Into<String>,
        source_community_generation: Option<u64>,
        nodes: Vec<GraphRenderNodeSource>,
        relations: Vec<GraphRenderRelationSource>,
        communities: Vec<GraphRenderCommunitySource>,
    ) -> Self {
        Self {
            owner_id: owner_id.into(),
            source_community_generation,
            nodes,
            relations,
            communities,
        }
    }
}
