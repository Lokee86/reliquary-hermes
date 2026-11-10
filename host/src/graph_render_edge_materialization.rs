use crate::graph_render_chunk_store::{GraphRenderChunkStore, GraphRenderEdgePayload};
use crate::graph_render_contract::GraphRenderEdgeLod;
use crate::graph_render_edge_payload::{
    push_aggregate_edge_payload, push_detail_edge_payload, push_reused_edge_payload,
};
use crate::graph_render_edge_projection_model::{
    GraphRenderDetailEdge, GraphRenderEdgeAggregate, GraphRenderEdgeProjection,
};
use crate::graph_render_edge_reuse::GraphRenderEdgeReuse;
use crate::graph_render_error::GraphRenderError;
use crate::graph_render_hierarchy_model::GraphRenderHierarchy;
use crate::graph_render_layout_model::GraphRenderLayout;
use std::collections::BTreeMap;

pub(crate) fn append_edge_chunks(
    generation_id: u64,
    hierarchy: &GraphRenderHierarchy,
    layout: &GraphRenderLayout,
    projection: &GraphRenderEdgeProjection,
    store: &mut GraphRenderChunkStore,
    previous: Option<(&GraphRenderEdgeProjection, &GraphRenderChunkStore)>,
) -> Result<(u32, u32), GraphRenderError> {
    let reuse = previous.map(|(projection, store)| GraphRenderEdgeReuse::new(projection, store));
    let mut next_chunk_id = 0_u32;
    let mut reused = 0_u32;
    let mut encoded = 0_u32;

    append_aggregate_chunk(
        generation_id,
        GraphRenderEdgeLod::Overview,
        &projection.overview,
        layout,
        reuse.as_ref().and_then(|reuse| {
            reuse.aggregate_payload(GraphRenderEdgeLod::Overview, &projection.overview)
        }),
        &mut next_chunk_id,
        store,
        &mut reused,
        &mut encoded,
    )?;
    append_aggregate_chunk(
        generation_id,
        GraphRenderEdgeLod::Intermediate,
        &projection.intermediate,
        layout,
        reuse.as_ref().and_then(|reuse| {
            reuse.aggregate_payload(GraphRenderEdgeLod::Intermediate, &projection.intermediate)
        }),
        &mut next_chunk_id,
        store,
        &mut reused,
        &mut encoded,
    )?;

    for (leaf_slot, edges) in projection.detail_by_leaf.iter().enumerate() {
        if edges.is_empty() {
            continue;
        }
        let leaf = &hierarchy.leaves[leaf_slot];
        debug_assert_eq!(leaf.chunk_id as usize, leaf_slot);
        let previous = reuse
            .as_ref()
            .and_then(|reuse| reuse.detail_payload(leaf_slot, edges));
        append_detail_chunk(
            generation_id,
            next_chunk_id,
            edges,
            layout,
            previous,
            store,
            &mut reused,
            &mut encoded,
        )?;
        next_chunk_id = next_chunk_id
            .checked_add(1)
            .ok_or(GraphRenderError::HierarchyIdOverflow)?;
    }

    Ok((reused, encoded))
}

#[allow(clippy::too_many_arguments)]
fn append_aggregate_chunk(
    generation_id: u64,
    lod: GraphRenderEdgeLod,
    aggregates: &BTreeMap<(u32, u32), GraphRenderEdgeAggregate>,
    layout: &GraphRenderLayout,
    previous: Option<&GraphRenderEdgePayload>,
    next_chunk_id: &mut u32,
    store: &mut GraphRenderChunkStore,
    reused: &mut u32,
    encoded: &mut u32,
) -> Result<(), GraphRenderError> {
    if aggregates.is_empty() {
        return Ok(());
    }
    if let Some(previous) = previous {
        push_reused_edge_payload(generation_id, *next_chunk_id, previous, store);
        *reused += 1;
    } else {
        push_aggregate_edge_payload(
            generation_id,
            *next_chunk_id,
            lod,
            aggregates,
            layout,
            store,
        )?;
        *encoded += 1;
    }
    *next_chunk_id = next_chunk_id
        .checked_add(1)
        .ok_or(GraphRenderError::HierarchyIdOverflow)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn append_detail_chunk(
    generation_id: u64,
    chunk_id: u32,
    edges: &[GraphRenderDetailEdge],
    layout: &GraphRenderLayout,
    previous: Option<&GraphRenderEdgePayload>,
    store: &mut GraphRenderChunkStore,
    reused: &mut u32,
    encoded: &mut u32,
) -> Result<(), GraphRenderError> {
    if let Some(previous) = previous {
        push_reused_edge_payload(generation_id, chunk_id, previous, store);
        *reused += 1;
    } else {
        push_detail_edge_payload(generation_id, chunk_id, edges, layout, store)?;
        *encoded += 1;
    }
    Ok(())
}
