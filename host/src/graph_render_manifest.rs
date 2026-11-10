use crate::graph_render_chunk_store::GraphRenderChunkStore;
use crate::graph_render_contract::{
    GRAPH_RENDER_MANIFEST_SCHEMA_VERSION, GraphRenderHierarchyDescriptor, GraphRenderManifest,
    decimal_u64,
};
use crate::graph_render_hierarchy_model::GraphRenderHierarchy;
use crate::graph_render_layout_model::GraphRenderLayout;

pub(crate) fn build_graph_render_manifest(
    generation_id: u64,
    owner_id: &str,
    source_community_generation: Option<u64>,
    hierarchy: &GraphRenderHierarchy,
    layout: &GraphRenderLayout,
    chunks: &GraphRenderChunkStore,
) -> GraphRenderManifest {
    let chunk_by_hierarchy = hierarchy
        .leaves
        .iter()
        .map(|leaf| (leaf.hierarchy_id, leaf.chunk_id))
        .collect::<std::collections::BTreeMap<_, _>>();

    let hierarchy = hierarchy
        .nodes
        .iter()
        .map(|node| GraphRenderHierarchyDescriptor {
            id: node.id,
            parent_id: node.parent_id,
            kind: node.kind,
            bounds: layout.hierarchy[node.id as usize].bounds,
            node_count: node.node_count,
            chunk_id: chunk_by_hierarchy.get(&node.id).copied(),
        })
        .collect();

    GraphRenderManifest {
        schema_version: GRAPH_RENDER_MANIFEST_SCHEMA_VERSION,
        generation_id: decimal_u64(generation_id),
        owner_id: owner_id.to_owned(),
        source_community_generation: source_community_generation.map(decimal_u64),
        total_node_count: layout.positions.len() as u32,
        root_hierarchy_id: 0,
        global_bounds: layout.global_bounds(),
        hierarchy,
        node_chunks: chunks
            .node_payloads
            .iter()
            .map(|payload| payload.descriptor.clone())
            .collect(),
        edge_chunks: chunks
            .edge_payloads
            .iter()
            .map(|payload| payload.descriptor.clone())
            .collect(),
    }
}
