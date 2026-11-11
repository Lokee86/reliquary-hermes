use crate::graph_render_chunk_store::GraphRenderChunkStore;
use crate::graph_render_contract::{
    GRAPH_RENDER_MANIFEST_SCHEMA_VERSION, GraphRenderHierarchyDescriptor, GraphRenderHierarchyKind,
    GraphRenderManifest, GraphRenderTerritory, GraphRenderTerritoryKind, decimal_u64,
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
    let mut radii_squared = vec![0.0_f32; hierarchy.nodes.len()];
    for leaf in &hierarchy.leaves {
        let mut parent = hierarchy.nodes[leaf.hierarchy_id as usize].parent_id;
        while let Some(id) = parent {
            let territory = &hierarchy.nodes[id as usize];
            if territory.kind == GraphRenderHierarchyKind::Territory {
                let center = layout.hierarchy[id as usize].center;
                for render_id in &leaf.render_ids {
                    let point = layout.positions[render_id.get() as usize];
                    let distance = (0..3)
                        .map(|axis| (point[axis] - center[axis]).powi(2))
                        .sum();
                    radii_squared[id as usize] = radii_squared[id as usize].max(distance);
                }
                break;
            }
            parent = territory.parent_id;
        }
    }

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
            territory: (node.kind == GraphRenderHierarchyKind::Territory).then(|| {
                let (kind, community_id, label, color) = match node.source_community_id {
                    Some(id) => {
                        let id_hex: String = id.iter().map(|byte| format!("{byte:02x}")).collect();
                        let label = hierarchy
                            .community_names
                            .get(&id)
                            .map(|name| name.chars().take(96).collect())
                            .unwrap_or_else(|| format!("Community {}", &id_hex[..8]));
                        (
                            GraphRenderTerritoryKind::Community,
                            Some(id_hex),
                            label,
                            community_color(id),
                        )
                    }
                    None => (
                        GraphRenderTerritoryKind::Unassigned,
                        None,
                        "Unassigned".to_owned(),
                        [0.56, 0.61, 0.69],
                    ),
                };
                GraphRenderTerritory {
                    kind,
                    community_id,
                    label,
                    color,
                    center: layout.hierarchy[node.id as usize].center,
                    radius: radii_squared[node.id as usize].sqrt() + 2.5,
                }
            }),
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

fn community_color(id: [u8; 32]) -> [f32; 3] {
    const PALETTE: [[f32; 3]; 11] = [
        [0.34, 0.73, 0.98],
        [0.96, 0.55, 0.35],
        [0.39, 0.83, 0.64],
        [0.72, 0.55, 0.96],
        [0.99, 0.74, 0.36],
        [0.96, 0.50, 0.69],
        [0.30, 0.80, 0.84],
        [0.67, 0.79, 0.38],
        [0.88, 0.46, 0.49],
        [0.53, 0.62, 0.98],
        [0.83, 0.54, 0.80],
    ];
    let hash = id.into_iter().fold(2_166_136_261_u32, |hash, byte| {
        (hash ^ u32::from(byte)).wrapping_mul(16_777_619)
    });
    PALETTE[hash as usize % PALETTE.len()]
}
