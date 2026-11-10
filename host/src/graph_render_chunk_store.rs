use crate::graph_render_contract::{
    GraphRenderEdgeChunkDescriptor, GraphRenderNodeChunkDescriptor,
};

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GraphRenderNodePayload {
    pub(crate) descriptor: GraphRenderNodeChunkDescriptor,
    pub(crate) bytes: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GraphRenderEdgePayload {
    pub(crate) descriptor: GraphRenderEdgeChunkDescriptor,
    pub(crate) bytes: Vec<u8>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct GraphRenderChunkStore {
    pub(crate) node_payloads: Vec<GraphRenderNodePayload>,
    pub(crate) edge_payloads: Vec<GraphRenderEdgePayload>,
}

impl GraphRenderChunkStore {
    pub(crate) fn node_payload(&self, chunk_id: u32) -> Option<&GraphRenderNodePayload> {
        self.node_payloads
            .get(chunk_id as usize)
            .filter(|payload| payload.descriptor.chunk_id == chunk_id)
    }

    pub(crate) fn edge_payload(&self, chunk_id: u32) -> Option<&GraphRenderEdgePayload> {
        self.edge_payloads
            .iter()
            .find(|payload| payload.descriptor.chunk_id == chunk_id)
    }
}
