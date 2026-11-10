use crate::graph_render::GraphRenderService;
use crate::graph_render_edge_chunk::GraphRenderEdgeChunk;
use crate::graph_render_identity::{GraphRenderNodeKey, GraphRenderNodeTarget, RenderNodeId};
use crate::graph_render_source::{
    GraphRenderNodeSource, GraphRenderRelationSource, GraphRenderSource,
};
use crate::graph_render_style::GraphRenderEdgeStyle;

#[test]
fn generic_node_keys_sort_independently_of_opaque_selection_targets() {
    let mut renderer = GraphRenderService::default();
    let source = GraphRenderSource::new(
        "arbitrary-source",
        None,
        vec![
            GraphRenderNodeSource::new(
                GraphRenderNodeKey::new(b"z".to_vec()),
                "Zed",
                GraphRenderNodeTarget::new("repository", b"target-z".to_vec()),
            ),
            GraphRenderNodeSource::new(
                GraphRenderNodeKey::new(b"a".to_vec()),
                "Ay",
                GraphRenderNodeTarget::new("repository", b"target-a".to_vec()),
            ),
        ],
        vec![],
        vec![],
    );

    let summary = renderer.prepare(source).unwrap();
    assert_eq!(summary.node_count, 2);
    assert_eq!(
        renderer
            .resolve_node(summary.generation_id, RenderNodeId::new(0))
            .unwrap(),
        GraphRenderNodeTarget::new("repository", b"target-a".to_vec()),
    );
    assert_eq!(
        renderer
            .resolve_node(summary.generation_id, RenderNodeId::new(1))
            .unwrap(),
        GraphRenderNodeTarget::new("repository", b"target-z".to_vec()),
    );
}
#[test]
fn arbitrary_edge_styles_survive_projection_and_binary_materialization() {
    let mut renderer = GraphRenderService::default();
    let style = GraphRenderEdgeStyle::new(0x1234_56ff, 12_345, 0x42);
    let summary = renderer
        .prepare(GraphRenderSource::new(
            "foreign-source",
            None,
            vec![
                GraphRenderNodeSource::new(
                    GraphRenderNodeKey::new(b"b".to_vec()),
                    "B",
                    GraphRenderNodeTarget::new("external", b"b".to_vec()),
                ),
                GraphRenderNodeSource::new(
                    GraphRenderNodeKey::new(b"a".to_vec()),
                    "A",
                    GraphRenderNodeTarget::new("external", b"a".to_vec()),
                ),
            ],
            vec![GraphRenderRelationSource {
                source: GraphRenderNodeKey::new(b"a".to_vec()),
                target: GraphRenderNodeKey::new(b"b".to_vec()),
                style,
            }],
            vec![],
        ))
        .unwrap();
    let manifest = renderer.manifest(summary.generation_id).unwrap();
    assert_eq!(manifest.total_node_count, 2);
    assert_eq!(manifest.edge_chunks.len(), 1);
    let encoded = renderer
        .edge_chunk(summary.generation_id, manifest.edge_chunks[0].chunk_id)
        .unwrap();
    let chunk = GraphRenderEdgeChunk::decode(encoded).unwrap();
    assert_eq!(chunk.packed_colors, vec![style.packed_color]);
    assert_eq!(chunk.weights, vec![1.2345]);
    let hierarchy = renderer.hierarchy(summary.generation_id).unwrap();
    assert_eq!(hierarchy.leaves.len(), 1);
}
#[test]
fn blank_non_memory_labels_use_generic_fallback() {
    let mut renderer = GraphRenderService::default();
    let source = GraphRenderSource::new(
        "generic",
        None,
        vec![GraphRenderNodeSource::new(
            GraphRenderNodeKey::new(b"unlabelled".to_vec()),
            "   ",
            GraphRenderNodeTarget::new("external", b"id".to_vec()),
        )],
        vec![],
        vec![],
    );
    let summary = renderer.prepare(source).unwrap();
    let manifest = renderer.manifest(summary.generation_id).unwrap();
    assert_eq!(manifest.node_chunks[0].label_candidates[0].label, "Node 0");
}
