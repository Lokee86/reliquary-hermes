use crate::graph_render_identity::GraphRenderNodeKey;
use crate::graph_render_identity::RenderNodeId;
use std::fmt;

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum GraphRenderError {
    DuplicateNodeKey(GraphRenderNodeKey),
    DuplicateCommunityId([u8; 32]),
    DuplicateCommunityMember {
        community_id: [u8; 32],
        node_key: GraphRenderNodeKey,
    },
    NodeInMultipleCommunities {
        node_key: GraphRenderNodeKey,
        first_community_id: [u8; 32],
        second_community_id: [u8; 32],
    },
    CommunityNodeUnavailable {
        community_id: [u8; 32],
        node_key: GraphRenderNodeKey,
    },
    RelationNodeUnavailable(GraphRenderNodeKey),
    NodeChunkUnavailable {
        generation_id: u64,
        chunk_id: u32,
    },
    NodeChunkEncoding(String),
    EdgeChunkEncoding(String),
    EdgeChunkUnavailable {
        generation_id: u64,
        chunk_id: u32,
    },
    NodeCountOverflow(usize),
    HierarchyIdOverflow,
    GenerationIdExhausted,
    GenerationUnavailable(u64),
    RenderNodeUnavailable {
        generation_id: u64,
        render_id: RenderNodeId,
    },
}

impl fmt::Display for GraphRenderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DuplicateNodeKey(node_key) => {
                write!(
                    formatter,
                    "graph render source contains duplicate node key {}",
                    hex(&node_key.0)
                )
            }
            Self::DuplicateCommunityId(community_id) => write!(
                formatter,
                "graph render source contains duplicate community ID {}",
                hex(community_id)
            ),
            Self::DuplicateCommunityMember {
                community_id,
                node_key,
            } => write!(
                formatter,
                "graph render community {} contains duplicate node key {}",
                hex(community_id),
                hex(&node_key.0)
            ),
            Self::NodeInMultipleCommunities {
                node_key,
                first_community_id,
                second_community_id,
            } => write!(
                formatter,
                "graph render node key {} belongs to communities {} and {}",
                hex(&node_key.0),
                hex(first_community_id),
                hex(second_community_id)
            ),
            Self::CommunityNodeUnavailable {
                community_id,
                node_key,
            } => write!(
                formatter,
                "graph render community {} references unavailable node key {}",
                hex(community_id),
                hex(&node_key.0)
            ),
            Self::RelationNodeUnavailable(node_key) => write!(
                formatter,
                "graph render relation references unavailable node key {}",
                hex(&node_key.0)
            ),
            Self::NodeChunkUnavailable {
                generation_id,
                chunk_id,
            } => write!(
                formatter,
                "graph render node chunk {chunk_id} is unavailable in generation {generation_id}"
            ),
            Self::NodeChunkEncoding(error) => {
                write!(
                    formatter,
                    "graph render node chunk encoding failed: {error}"
                )
            }
            Self::EdgeChunkEncoding(error) => {
                write!(
                    formatter,
                    "graph render edge chunk encoding failed: {error}"
                )
            }
            Self::EdgeChunkUnavailable {
                generation_id,
                chunk_id,
            } => write!(
                formatter,
                "graph render edge chunk {chunk_id} is unavailable in generation {generation_id}"
            ),
            Self::NodeCountOverflow(count) => write!(
                formatter,
                "graph render generation cannot address {count} nodes with u32 render IDs"
            ),
            Self::HierarchyIdOverflow => write!(
                formatter,
                "graph render hierarchy exceeds u32 hierarchy or chunk identity"
            ),
            Self::GenerationIdExhausted => {
                write!(formatter, "graph render generation ID space is exhausted")
            }
            Self::GenerationUnavailable(generation_id) => write!(
                formatter,
                "graph render generation {generation_id} is unavailable"
            ),
            Self::RenderNodeUnavailable {
                generation_id,
                render_id,
            } => write!(
                formatter,
                "graph render node {} is unavailable in generation {generation_id}",
                render_id.get()
            ),
        }
    }
}

impl std::error::Error for GraphRenderError {}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
