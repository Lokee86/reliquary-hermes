use crate::graph_render_hierarchy::build_graph_render_hierarchy;
use crate::graph_render_identity::{GraphRenderNodeKey, GraphRenderNodeTarget};
use crate::graph_render_layout::build_graph_render_layout;
use crate::graph_render_node_chunk::{GraphRenderNodeChunk, graph_render_node_chunk_len};
use crate::graph_render_node_materialization::{
    GRAPH_RENDER_LABEL_CANDIDATES_PER_CHUNK, GRAPH_RENDER_LABEL_MAX_CHARS, build_node_chunk_store,
};
use crate::graph_render_source::GraphRenderNodeSource;
use crate::graph_render_style::{node_color_from_degree, node_size_from_degree};

#[test]
fn leaf_materialization_emits_frozen_binary_payload_and_descriptor() {
    let memories = memories(3);
    let hierarchy = build_graph_render_hierarchy(&memories, vec![], 8, 2).unwrap();
    let layout = build_graph_render_layout(&hierarchy, 3);
    let degrees = vec![1, 2, 1];

    let sources = memory_sources(&memories);
    let (store, reused, encoded) =
        build_node_chunk_store(77, &hierarchy, &layout, &degrees, &sources, None).unwrap();
    assert_eq!((reused, encoded), (0, 1));

    assert_eq!(store.node_payloads.len(), 1);
    let payload = &store.node_payloads[0];
    let leaf = &hierarchy.leaves[0];
    assert_eq!(payload.descriptor.chunk_id, 0);
    assert_eq!(payload.descriptor.parent_hierarchy_id, leaf.hierarchy_id);
    assert_eq!(
        payload.descriptor.bounds,
        layout.hierarchy[leaf.hierarchy_id as usize].bounds,
    );
    assert_eq!(payload.descriptor.node_count, 3);
    assert_eq!(
        payload.descriptor.byte_len as usize,
        graph_render_node_chunk_len(3).unwrap(),
    );
    assert_eq!(
        payload
            .descriptor
            .label_candidates
            .iter()
            .map(|candidate| (
                candidate.render_id,
                candidate.item_index,
                candidate.importance,
                candidate.label.as_str(),
            ))
            .collect::<Vec<_>>(),
        vec![
            (1, 1, 2, "Memory 2"),
            (0, 0, 1, "Memory 1"),
            (2, 2, 1, "Memory 3"),
        ],
    );

    let decoded = GraphRenderNodeChunk::decode(&payload.bytes).unwrap();
    assert_eq!(decoded.generation_id, 77);
    assert_eq!(decoded.chunk_id, 0);
    assert_eq!(decoded.positions, layout.positions);
    assert_eq!(
        decoded.packed_colors,
        vec![
            node_color_from_degree(1),
            node_color_from_degree(2),
            node_color_from_degree(1),
        ],
    );
    assert_eq!(
        decoded.sizes,
        vec![
            node_size_from_degree(1),
            node_size_from_degree(2),
            node_size_from_degree(1),
        ],
    );
    assert_eq!(
        decoded
            .render_ids
            .iter()
            .map(|id| id.get())
            .collect::<Vec<_>>(),
        vec![0, 1, 2],
    );
}

#[test]
fn materialization_preserves_leaf_and_chunk_order() {
    let memories = memories(5);
    let hierarchy = build_graph_render_hierarchy(&memories, vec![], 2, 2).unwrap();
    let layout = build_graph_render_layout(&hierarchy, 5);
    let sources = memory_sources(&memories);
    let (store, reused, encoded) =
        build_node_chunk_store(5, &hierarchy, &layout, &[0; 5], &sources, None).unwrap();
    assert_eq!((reused, encoded), (0, 3));

    assert_eq!(
        store
            .node_payloads
            .iter()
            .map(|payload| payload.descriptor.chunk_id)
            .collect::<Vec<_>>(),
        vec![0, 1, 2],
    );
    assert_eq!(
        store
            .node_payloads
            .iter()
            .map(|payload| payload.descriptor.node_count)
            .collect::<Vec<_>>(),
        vec![2, 2, 1],
    );
}

#[test]
fn label_candidates_are_bounded_and_labels_are_length_bounded() {
    assert_eq!(GRAPH_RENDER_LABEL_CANDIDATES_PER_CHUNK, 4);
    assert_eq!(GRAPH_RENDER_LABEL_MAX_CHARS, 64);

    let memories = memories(6);
    let hierarchy = build_graph_render_hierarchy(&memories, vec![], 8, 2).unwrap();
    let layout = build_graph_render_layout(&hierarchy, 6);
    let mut sources = memory_sources(&memories);
    sources[5].label = "x".repeat(100);
    let (store, reused, encoded) =
        build_node_chunk_store(9, &hierarchy, &layout, &[0, 2, 5, 4, 3, 9], &sources, None)
            .unwrap();
    assert_eq!((reused, encoded), (0, 1));

    let candidates = &store.node_payloads[0].descriptor.label_candidates;
    assert_eq!(candidates.len(), 4);
    assert_eq!(
        candidates
            .iter()
            .map(|candidate| candidate.render_id)
            .collect::<Vec<_>>(),
        vec![5, 2, 3, 4],
    );
    assert!(candidates[0].label.chars().count() <= GRAPH_RENDER_LABEL_MAX_CHARS);
    assert!(candidates[0].label.ends_with("..."));
}

fn memory_sources(ids: &[GraphRenderNodeKey]) -> Vec<GraphRenderNodeSource> {
    ids.iter()
        .enumerate()
        .map(|(index, id)| {
            GraphRenderNodeSource::new(
                id.clone(),
                format!("Memory {}", index + 1),
                GraphRenderNodeTarget::new("memory", id.0.clone()),
            )
        })
        .collect()
}

fn memories(count: u8) -> Vec<GraphRenderNodeKey> {
    (1..=count).map(memory_id).collect()
}

fn memory_id(value: u8) -> GraphRenderNodeKey {
    let mut bytes = [0_u8; 32];
    bytes[31] = value;
    GraphRenderNodeKey::new(bytes.to_vec())
}
