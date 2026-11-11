use crate::graph_render::GraphRenderService;
use crate::graph_render_binary::GRAPH_RENDER_BINARY_HEADER_LEN;
use crate::graph_render_hierarchy::DEFAULT_GRAPH_RENDER_LEAF_CAPACITY;
use crate::graph_render_identity::{GraphRenderNodeKey, GraphRenderNodeTarget};
use crate::graph_render_source::{
    GraphRenderNodeSource, GraphRenderRelationSource, GraphRenderSource,
};
use crate::graph_render_source_style::style_for_relation;
use reliquary_memory::{RelationKind, RelationOrigin};

#[test]
fn local_label_mutation_reuses_unaffected_leaf_and_aggregate_chunk() {
    let mut service = GraphRenderService::default();
    let count = DEFAULT_GRAPH_RENDER_LEAF_CAPACITY + 1;
    let relations = vec![relation(
        0,
        DEFAULT_GRAPH_RENDER_LEAF_CAPACITY,
        RelationKind::Topical,
    )];
    let first = service
        .prepare(source("owner", 1, count, relations.clone()))
        .unwrap();
    assert_eq!(first.reuse.node_chunks_encoded, 2);
    assert_eq!(first.reuse.edge_chunks_encoded, 2);

    let old_leaf = service.node_chunk(first.generation_id, 1).unwrap().to_vec();
    let old_edge = service.edge_chunk(first.generation_id, 0).unwrap().to_vec();

    let mut changed = source("owner", 2, count, relations);
    changed.nodes[0].label = "Changed label".into();
    let second = service.prepare(changed).unwrap();

    assert!(second.reuse.hierarchy_layout_reused);
    assert_eq!(second.reuse.node_chunks_reused, 1);
    assert_eq!(second.reuse.node_chunks_encoded, 1);
    assert_eq!(second.reuse.edge_chunks_reused, 2);
    assert_eq!(second.reuse.edge_chunks_encoded, 0);

    let new_leaf = service.node_chunk(second.generation_id, 1).unwrap();
    let new_edge = service.edge_chunk(second.generation_id, 0).unwrap();
    assert_eq!(
        &old_leaf[GRAPH_RENDER_BINARY_HEADER_LEN..],
        &new_leaf[GRAPH_RENDER_BINARY_HEADER_LEN..],
    );
    assert_eq!(
        &old_edge[GRAPH_RENDER_BINARY_HEADER_LEN..],
        &new_edge[GRAPH_RENDER_BINARY_HEADER_LEN..],
    );
}

#[test]
fn topology_mutation_reencodes_layout_chunks_without_stale_positions() {
    let mut service = GraphRenderService::default();
    let count = DEFAULT_GRAPH_RENDER_LEAF_CAPACITY + 2;
    let first_relations = vec![
        relation(0, 1, RelationKind::Topical),
        relation(
            DEFAULT_GRAPH_RENDER_LEAF_CAPACITY,
            DEFAULT_GRAPH_RENDER_LEAF_CAPACITY + 1,
            RelationKind::Topical,
        ),
    ];
    let first = service
        .prepare(source("owner", 1, count, first_relations))
        .unwrap();
    let first_positions = service
        .layout(first.generation_id)
        .unwrap()
        .positions
        .clone();
    let old_first_detail = service.edge_chunk(first.generation_id, 0).unwrap().to_vec();

    let second_relations = vec![
        relation(0, 1, RelationKind::Causal),
        relation(
            DEFAULT_GRAPH_RENDER_LEAF_CAPACITY,
            DEFAULT_GRAPH_RENDER_LEAF_CAPACITY + 1,
            RelationKind::Topical,
        ),
    ];
    let second = service
        .prepare(source("owner", 2, count, second_relations))
        .unwrap();
    let second_positions = service
        .layout(second.generation_id)
        .unwrap()
        .positions
        .clone();

    assert!(!second.reuse.hierarchy_layout_reused);
    assert_ne!(first_positions, second_positions);
    assert_eq!(
        second.reuse.node_chunks_reused + second.reuse.node_chunks_encoded,
        2
    );
    for chunk_id in 0..2 {
        let chunk = crate::graph_render_node_chunk::GraphRenderNodeChunk::decode(
            service.node_chunk(second.generation_id, chunk_id).unwrap(),
        )
        .unwrap();
        for (render_id, position) in chunk.render_ids.iter().zip(&chunk.positions) {
            assert_eq!(*position, second_positions[render_id.get() as usize]);
        }
    }
    assert_eq!(
        second.reuse.edge_chunks_reused + second.reuse.edge_chunks_encoded,
        2
    );

    let new_first_detail = service.edge_chunk(second.generation_id, 0).unwrap();
    let new_second_detail = service.edge_chunk(second.generation_id, 1).unwrap();
    assert_ne!(
        &old_first_detail[GRAPH_RENDER_BINARY_HEADER_LEN..],
        &new_first_detail[GRAPH_RENDER_BINARY_HEADER_LEN..],
        "changed topology must not retain stale edge positions",
    );
    let decoded =
        crate::graph_render_edge_chunk::GraphRenderEdgeChunk::decode(new_second_detail).unwrap();
    assert_eq!(
        decoded.endpoints[0],
        [
            second_positions[DEFAULT_GRAPH_RENDER_LEAF_CAPACITY as usize],
            second_positions[DEFAULT_GRAPH_RENDER_LEAF_CAPACITY as usize + 1]
        ]
    );
}

fn source(
    owner: &str,
    generation: u64,
    count: u32,
    relations: Vec<GraphRenderRelationSource>,
) -> GraphRenderSource {
    GraphRenderSource::new(
        owner,
        Some(generation),
        (0..count)
            .map(|value| {
                GraphRenderNodeSource::new(
                    memory_id(value),
                    format!("Memory {value}"),
                    GraphRenderNodeTarget::new("memory", memory_id(value).0),
                )
            })
            .collect(),
        relations,
        vec![],
    )
}

fn relation(source: u32, target: u32, kind: RelationKind) -> GraphRenderRelationSource {
    GraphRenderRelationSource {
        source: memory_id(source),
        target: memory_id(target),
        style: style_for_relation(kind, RelationOrigin::Dream),
    }
}

fn memory_id(value: u32) -> GraphRenderNodeKey {
    let mut bytes = [0_u8; 32];
    bytes[28..].copy_from_slice(&value.to_be_bytes());
    GraphRenderNodeKey::new(bytes.to_vec())
}
