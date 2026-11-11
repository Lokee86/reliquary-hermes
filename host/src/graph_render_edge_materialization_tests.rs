use crate::graph_render_chunk_store::GraphRenderChunkStore;
use crate::graph_render_contract::GraphRenderEdgeLod;
use crate::graph_render_edge_chunk::GraphRenderEdgeChunk;
use crate::graph_render_edge_materialization::append_edge_chunks;
use crate::graph_render_edge_projection::build_edge_projection;
use crate::graph_render_hierarchy::build_graph_render_hierarchy;
use crate::graph_render_identity::GraphRenderNodeKey;
use crate::graph_render_layout::build_graph_render_layout;
use crate::graph_render_source::{GraphRenderCommunitySource, GraphRenderRelationSource};
use crate::graph_render_source_style::style_for_relation;
use reliquary_memory::{RelationKind, RelationOrigin};

#[test]
fn materialization_emits_overview_intermediate_and_detail_payloads() {
    let memories = memories(4);
    let hierarchy = build_graph_render_hierarchy(
        &memories,
        vec![
            community(1, vec![memory_id(1), memory_id(2)]),
            community(2, vec![memory_id(3), memory_id(4)]),
        ],
        2,
        2,
    )
    .unwrap();
    let layout = build_graph_render_layout(&hierarchy, 4);
    let projection = build_edge_projection(
        &memories,
        &[relation(1, 2), relation(2, 3), relation(3, 4)],
        &hierarchy,
    )
    .unwrap();
    let mut store = GraphRenderChunkStore::default();

    let (reused, encoded) =
        append_edge_chunks(44, &hierarchy, &layout, &projection, &mut store, None).unwrap();
    assert_eq!((reused, encoded), (0, 4));

    assert_eq!(store.edge_payloads.len(), 4);
    assert_eq!(
        store.edge_payloads[0].descriptor.lod,
        GraphRenderEdgeLod::Overview
    );
    assert_eq!(
        store.edge_payloads[1].descriptor.lod,
        GraphRenderEdgeLod::Intermediate,
    );
    assert_eq!(
        store.edge_payloads[2].descriptor.lod,
        GraphRenderEdgeLod::Detail
    );
    assert_eq!(
        store.edge_payloads[3].descriptor.lod,
        GraphRenderEdgeLod::Detail
    );
    assert_eq!(
        store
            .edge_payloads
            .iter()
            .map(|payload| payload.descriptor.segment_count)
            .collect::<Vec<_>>(),
        vec![1, 1, 2, 1]
    );
    // The cross-community relationship remains a real node segment in detail.
    let detail = GraphRenderEdgeChunk::decode(&store.edge_payloads[2].bytes).unwrap();
    assert!(
        detail
            .endpoints
            .contains(&[layout.positions[1], layout.positions[2]])
    );

    for payload in &store.edge_payloads {
        let decoded = GraphRenderEdgeChunk::decode(&payload.bytes).unwrap();
        assert_eq!(decoded.generation_id, 44);
        assert_eq!(decoded.chunk_id, payload.descriptor.chunk_id);
        assert_eq!(
            decoded.endpoints.len() as u32,
            payload.descriptor.segment_count,
        );
        assert_eq!(payload.descriptor.byte_len as usize, payload.bytes.len());
    }
}

#[test]
fn aggregate_weight_sums_logical_relationships_without_extra_segments() {
    let memories = memories(4);
    let hierarchy = build_graph_render_hierarchy(
        &memories,
        vec![
            community(1, vec![memory_id(1), memory_id(2)]),
            community(2, vec![memory_id(3), memory_id(4)]),
        ],
        2,
        2,
    )
    .unwrap();
    let layout = build_graph_render_layout(&hierarchy, 4);
    let projection = build_edge_projection(
        &memories,
        &[relation(1, 3), relation(1, 4), relation(2, 3)],
        &hierarchy,
    )
    .unwrap();
    let mut store = GraphRenderChunkStore::default();

    let (reused, encoded) =
        append_edge_chunks(1, &hierarchy, &layout, &projection, &mut store, None).unwrap();
    assert_eq!((reused, encoded), (0, 3));

    let overview = GraphRenderEdgeChunk::decode(&store.edge_payloads[0].bytes).unwrap();
    assert_eq!(overview.endpoints.len(), 1);
    assert!((overview.weights[0] - 2.7).abs() < 0.0001);
}

fn relation(source: u8, target: u8) -> GraphRenderRelationSource {
    GraphRenderRelationSource {
        source: memory_id(source),
        target: memory_id(target),
        style: style_for_relation(RelationKind::Topical, RelationOrigin::Dream),
    }
}

fn community(id: u8, members: Vec<GraphRenderNodeKey>) -> GraphRenderCommunitySource {
    GraphRenderCommunitySource::new(memory_id(id).0.clone().try_into().unwrap(), members)
}

fn memories(count: u8) -> Vec<GraphRenderNodeKey> {
    (1..=count).map(memory_id).collect()
}

fn memory_id(value: u8) -> GraphRenderNodeKey {
    let mut bytes = [0_u8; 32];
    bytes[31] = value;
    GraphRenderNodeKey::new(bytes.to_vec())
}
