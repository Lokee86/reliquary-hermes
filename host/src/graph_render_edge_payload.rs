use crate::graph_render_binary::rebind_payload_header;
use crate::graph_render_chunk_store::{GraphRenderChunkStore, GraphRenderEdgePayload};
use crate::graph_render_contract::{
    GraphRenderBounds, GraphRenderEdgeChunkDescriptor, GraphRenderEdgeLod,
};
use crate::graph_render_edge_chunk::GraphRenderEdgeChunk;
use crate::graph_render_edge_projection_model::{GraphRenderDetailEdge, GraphRenderEdgeAggregate};
use crate::graph_render_error::GraphRenderError;
use crate::graph_render_layout_model::GraphRenderLayout;
use crate::graph_render_style::edge_weight_from_units;
use std::collections::BTreeMap;

pub(crate) fn push_reused_edge_payload(
    generation_id: u64,
    chunk_id: u32,
    previous: &GraphRenderEdgePayload,
    store: &mut GraphRenderChunkStore,
) {
    let mut descriptor = previous.descriptor.clone();
    descriptor.chunk_id = chunk_id;
    store.edge_payloads.push(GraphRenderEdgePayload {
        descriptor,
        bytes: rebind_payload_header(&previous.bytes, generation_id, chunk_id),
    });
}

pub(crate) fn push_aggregate_edge_payload(
    generation_id: u64,
    chunk_id: u32,
    lod: GraphRenderEdgeLod,
    aggregates: &BTreeMap<(u32, u32), GraphRenderEdgeAggregate>,
    layout: &GraphRenderLayout,
    store: &mut GraphRenderChunkStore,
) -> Result<(), GraphRenderError> {
    let endpoints = aggregates
        .keys()
        .map(|(source, target)| {
            [
                layout.hierarchy[*source as usize].center,
                layout.hierarchy[*target as usize].center,
            ]
        })
        .collect::<Vec<_>>();
    let weights = aggregates
        .values()
        .map(|aggregate| edge_weight_from_units(aggregate.weight_units))
        .collect::<Vec<_>>();
    let packed_colors = aggregates
        .values()
        .map(|aggregate| aggregate.packed_color())
        .collect::<Vec<_>>();
    push_encoded_edge_payload(
        generation_id,
        chunk_id,
        lod,
        endpoints,
        weights,
        packed_colors,
        store,
    )
}

pub(crate) fn push_detail_edge_payload(
    generation_id: u64,
    chunk_id: u32,
    edges: &[GraphRenderDetailEdge],
    layout: &GraphRenderLayout,
    store: &mut GraphRenderChunkStore,
) -> Result<(), GraphRenderError> {
    let endpoints = edges
        .iter()
        .map(|edge| {
            [
                layout.positions[edge.source.get() as usize],
                layout.positions[edge.target.get() as usize],
            ]
        })
        .collect::<Vec<_>>();
    let weights = edges
        .iter()
        .map(|edge| edge_weight_from_units(edge.style.weight_units as u64))
        .collect::<Vec<_>>();
    let packed_colors = edges
        .iter()
        .map(|edge| edge.style.packed_color)
        .collect::<Vec<_>>();
    push_encoded_edge_payload(
        generation_id,
        chunk_id,
        GraphRenderEdgeLod::Detail,
        endpoints,
        weights,
        packed_colors,
        store,
    )
}

fn push_encoded_edge_payload(
    generation_id: u64,
    chunk_id: u32,
    lod: GraphRenderEdgeLod,
    endpoints: Vec<[[f32; 3]; 2]>,
    weights: Vec<f32>,
    packed_colors: Vec<u32>,
    store: &mut GraphRenderChunkStore,
) -> Result<(), GraphRenderError> {
    let bounds = bounds_for_endpoints(&endpoints);
    let chunk = GraphRenderEdgeChunk {
        generation_id,
        chunk_id,
        endpoints,
        weights,
        packed_colors,
    };
    let segment_count = chunk.endpoints.len() as u32;
    let bytes = chunk
        .encode()
        .map_err(|error| GraphRenderError::EdgeChunkEncoding(error.to_string()))?;
    let byte_len = u32::try_from(bytes.len())
        .map_err(|_| GraphRenderError::EdgeChunkEncoding("payload exceeds u32 length".into()))?;
    store.edge_payloads.push(GraphRenderEdgePayload {
        descriptor: GraphRenderEdgeChunkDescriptor {
            chunk_id,
            lod,
            bounds,
            segment_count,
            byte_len,
        },
        bytes,
    });
    Ok(())
}

fn bounds_for_endpoints(endpoints: &[[[f32; 3]; 2]]) -> GraphRenderBounds {
    let Some(first) = endpoints.first() else {
        return GraphRenderBounds::new([0.0; 3], [0.0; 3]);
    };
    let mut min = first[0];
    let mut max = first[0];
    for point in endpoints.iter().flat_map(|edge| edge.iter()) {
        for axis in 0..3 {
            min[axis] = min[axis].min(point[axis]);
            max[axis] = max[axis].max(point[axis]);
        }
    }
    GraphRenderBounds::new(min, max)
}
