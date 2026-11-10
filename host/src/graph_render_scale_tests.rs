use crate::graph_render::GraphRenderService;
use crate::graph_render_identity::{GraphRenderNodeKey, GraphRenderNodeTarget};
use crate::graph_render_source::{
    GraphRenderNodeSource, GraphRenderRelationSource, GraphRenderSource,
};
use crate::graph_render_source_style::style_for_relation;
use reliquary_memory::{RelationKind, RelationOrigin};
use std::time::Instant;

#[test]
#[ignore = "large synthetic renderer characterization; run explicitly with --ignored"]
fn warlock_renderer_medium_and_large_synthetic_tiers() {
    characterize(100_000, 1_000_000);
    characterize(1_000_000, 10_000_000);
}

fn characterize(node_count: usize, edge_count: usize) {
    let keys = (0..node_count)
        .map(|index| GraphRenderNodeKey::new((index as u32).to_be_bytes().to_vec()))
        .collect::<Vec<_>>();
    let nodes = keys
        .iter()
        .enumerate()
        .map(|(index, key)| {
            let mut memory_id = [0; 32];
            memory_id[..4].copy_from_slice(&(index as u32).to_be_bytes());
            GraphRenderNodeSource::new(
                key.clone(),
                format!("Synthetic memory {index}"),
                GraphRenderNodeTarget::new("memory", memory_id.to_vec()),
            )
        })
        .collect::<Vec<_>>();
    let relations = (0..edge_count)
        .map(|index| {
            let source = index % node_count;
            let target = (source + 1 + (index / node_count)) % node_count;
            GraphRenderRelationSource {
                source: keys[source].clone(),
                target: keys[target].clone(),
                style: style_for_relation(RelationKind::Topical, RelationOrigin::Dream),
            }
        })
        .collect::<Vec<_>>();
    let mut service = GraphRenderService::default();
    let start = Instant::now();
    let summary = service
        .prepare(GraphRenderSource::new(
            "synthetic-owner",
            None,
            nodes,
            relations,
            vec![],
        ))
        .unwrap();
    let elapsed = start.elapsed();
    let manifest = service.manifest(summary.generation_id).unwrap();
    let chunk_bytes = service.resident_bytes(summary.generation_id).unwrap();
    println!(
        "renderer characterization nodes={} input_edges={} output_nodes={} node_chunks={} edge_chunks={} chunk_bytes={} manifest_bytes={} elapsed_ms={}",
        node_count,
        edge_count,
        manifest.total_node_count,
        manifest.node_chunks.len(),
        manifest.edge_chunks.len(),
        chunk_bytes,
        serde_json::to_vec(manifest).unwrap().len(),
        elapsed.as_millis(),
    );
    assert_eq!(summary.node_count as usize, node_count);
}
