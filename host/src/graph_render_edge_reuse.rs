use crate::graph_render_chunk_store::{GraphRenderChunkStore, GraphRenderEdgePayload};
use crate::graph_render_contract::GraphRenderEdgeLod;
use crate::graph_render_edge_projection_model::{
    GraphRenderDetailEdge, GraphRenderEdgeAggregate, GraphRenderEdgeProjection,
};
use std::collections::BTreeMap;

pub(crate) struct GraphRenderEdgeReuse<'a> {
    projection: &'a GraphRenderEdgeProjection,
    store: &'a GraphRenderChunkStore,
}

impl<'a> GraphRenderEdgeReuse<'a> {
    pub(crate) fn new(
        projection: &'a GraphRenderEdgeProjection,
        store: &'a GraphRenderChunkStore,
    ) -> Self {
        Self { projection, store }
    }

    pub(crate) fn aggregate_payload(
        &self,
        lod: GraphRenderEdgeLod,
        current: &BTreeMap<(u32, u32), GraphRenderEdgeAggregate>,
    ) -> Option<&GraphRenderEdgePayload> {
        let (previous, chunk_id) = match lod {
            GraphRenderEdgeLod::Overview => {
                (&self.projection.overview, overview_id(self.projection)?)
            }
            GraphRenderEdgeLod::Intermediate => (
                &self.projection.intermediate,
                intermediate_id(self.projection)?,
            ),
            GraphRenderEdgeLod::Detail => return None,
        };
        (previous == current)
            .then(|| self.store.edge_payload(chunk_id))
            .flatten()
    }

    pub(crate) fn detail_payload(
        &self,
        leaf_slot: usize,
        current: &[GraphRenderDetailEdge],
    ) -> Option<&GraphRenderEdgePayload> {
        let previous = self.projection.detail_by_leaf.get(leaf_slot)?;
        if previous.as_slice() != current {
            return None;
        }
        let chunk_id = detail_id(self.projection, leaf_slot)?;
        self.store.edge_payload(chunk_id)
    }
}

fn overview_id(projection: &GraphRenderEdgeProjection) -> Option<u32> {
    (!projection.overview.is_empty()).then_some(0)
}

fn intermediate_id(projection: &GraphRenderEdgeProjection) -> Option<u32> {
    if projection.intermediate.is_empty() {
        return None;
    }
    Some(u32::from(!projection.overview.is_empty()))
}

fn detail_id(projection: &GraphRenderEdgeProjection, leaf_slot: usize) -> Option<u32> {
    if projection.detail_by_leaf.get(leaf_slot)?.is_empty() {
        return None;
    }
    let aggregate_count =
        u32::from(!projection.overview.is_empty()) + u32::from(!projection.intermediate.is_empty());
    let preceding = projection.detail_by_leaf[..leaf_slot]
        .iter()
        .filter(|edges| !edges.is_empty())
        .count() as u32;
    Some(aggregate_count + preceding)
}
