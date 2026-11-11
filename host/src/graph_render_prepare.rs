use crate::graph_render_edge_materialization::append_edge_chunks;
use crate::graph_render_edge_projection::build_edge_projection;
use crate::graph_render_error::GraphRenderError;
use crate::graph_render_generation::{
    GraphRenderGeneration, GraphRenderGenerationSummary, GraphRenderReuseStats,
};
use crate::graph_render_hierarchy::{
    DEFAULT_GRAPH_RENDER_LEAF_CAPACITY, GRAPH_RENDER_SUBGROUP_LEAF_FANOUT,
    build_graph_render_hierarchy,
};
use crate::graph_render_layout::build_graph_render_layout_with_degrees;
use crate::graph_render_manifest::build_graph_render_manifest;
use crate::graph_render_node_materialization::{GraphRenderNodeReuse, build_node_chunk_store};
use crate::graph_render_source::GraphRenderSource;

pub(crate) fn build_graph_render_generation(
    generation_id: u64,
    mut source: GraphRenderSource,
    previous: Option<&GraphRenderGeneration>,
) -> Result<GraphRenderGeneration, GraphRenderError> {
    source
        .nodes
        .sort_unstable_by(|left, right| left.key.cmp(&right.key));
    reject_invalid_node_keys(&source)?;

    let node_keys = source
        .nodes
        .iter()
        .map(|node| node.key.clone())
        .collect::<Vec<_>>();
    let node_targets = source
        .nodes
        .iter()
        .map(|node| node.target.clone())
        .collect();
    let candidate_hierarchy = build_graph_render_hierarchy(
        &node_keys,
        source.communities,
        DEFAULT_GRAPH_RENDER_LEAF_CAPACITY,
        GRAPH_RENDER_SUBGROUP_LEAF_FANOUT,
    )?;

    let structure_reused = previous.is_some_and(|previous| {
        previous.node_keys == node_keys && previous.hierarchy == candidate_hierarchy
    });
    let mut edge_projection =
        build_edge_projection(&node_keys, &source.relations, &candidate_hierarchy)?;
    let layout_fingerprint = edge_projection
        .layout_topology
        .fingerprint_with_degrees(&edge_projection.degrees);
    let layout_reused = previous.is_some_and(|previous| {
        structure_reused && previous.layout_fingerprint == layout_fingerprint
    });
    let (hierarchy, layout) = match previous.filter(|_| layout_reused) {
        Some(previous) => (previous.hierarchy.clone(), previous.layout.clone()),
        None => {
            let layout = build_graph_render_layout_with_degrees(
                &candidate_hierarchy,
                node_keys.len() as u32,
                &edge_projection.layout_topology,
                &edge_projection.degrees,
            );
            (candidate_hierarchy, layout)
        }
    };
    edge_projection.layout_topology = Default::default();

    let previous = previous.filter(|_| structure_reused);
    let node_reuse = previous.map(|previous| GraphRenderNodeReuse {
        previous_degrees: &previous.edge_projection.degrees,
        previous_positions: &previous.layout.positions,
        previous_store: &previous.chunks,
    });
    let (mut chunks, node_chunks_reused, node_chunks_encoded) = build_node_chunk_store(
        generation_id,
        &hierarchy,
        &layout,
        &edge_projection.degrees,
        &source.nodes,
        node_reuse,
    )?;
    let (edge_chunks_reused, edge_chunks_encoded) = append_edge_chunks(
        generation_id,
        &hierarchy,
        &layout,
        &edge_projection,
        &mut chunks,
        previous
            .filter(|_| layout_reused)
            .map(|previous| (&previous.edge_projection, &previous.chunks)),
    )?;

    let manifest = build_graph_render_manifest(
        generation_id,
        &source.owner_id,
        source.source_community_generation,
        &hierarchy,
        &layout,
        &chunks,
    );
    let reuse = GraphRenderReuseStats {
        hierarchy_layout_reused: layout_reused,
        node_chunks_reused,
        node_chunks_encoded,
        edge_chunks_reused,
        edge_chunks_encoded,
    };
    let summary = GraphRenderGenerationSummary {
        generation_id,
        owner_id: source.owner_id,
        source_community_generation: source.source_community_generation,
        node_count: node_keys.len() as u32,
        reuse,
    };

    Ok(GraphRenderGeneration {
        summary,
        node_keys,
        node_targets,
        hierarchy,
        layout,
        layout_fingerprint,
        edge_projection,
        manifest,
        chunks,
    })
}

fn reject_invalid_node_keys(source: &GraphRenderSource) -> Result<(), GraphRenderError> {
    if let Some(duplicate) = source
        .nodes
        .windows(2)
        .find(|pair| pair[0].key == pair[1].key)
        .map(|pair| pair[0].key.clone())
    {
        return Err(GraphRenderError::DuplicateNodeKey(duplicate));
    }
    if source.nodes.len() as u128 > u32::MAX as u128 {
        return Err(GraphRenderError::NodeCountOverflow(source.nodes.len()));
    }
    Ok(())
}
