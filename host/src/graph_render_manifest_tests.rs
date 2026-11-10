use crate::graph_render::GraphRenderService;
use crate::graph_render_contract::{
    GRAPH_RENDER_MANIFEST_SCHEMA_VERSION, GraphRenderEdgeLod, GraphRenderHierarchyKind,
    GraphRenderTerritoryKind,
};
use crate::graph_render_edge_chunk::GraphRenderEdgeChunk;
use crate::graph_render_error::GraphRenderError;
use crate::graph_render_identity::{GraphRenderNodeKey, GraphRenderNodeTarget};
use crate::graph_render_node_chunk::GraphRenderNodeChunk;
use crate::graph_render_source::{
    GraphRenderCommunitySource, GraphRenderNodeSource, GraphRenderRelationSource, GraphRenderSource,
};
use crate::graph_render_source_style::style_for_relation;
use reliquary_memory::{RelationKind, RelationOrigin};

#[test]
fn territory_metadata_distinguishes_communities_and_encloses_positioned_nodes() {
    let mut service = GraphRenderService::default();
    let summary = service
        .prepare(GraphRenderSource::new(
            "owner",
            Some(1),
            memories(3),
            vec![relation(1, 2)],
            vec![
                GraphRenderCommunitySource::new([1; 32], vec![memory_id(1), memory_id(2)])
                    .with_name(Some("Accepted name".to_owned())),
                GraphRenderCommunitySource::new([2; 32], vec![]),
            ],
        ))
        .unwrap();
    let generation = summary.generation_id;
    let manifest = service.manifest(generation).unwrap();
    let territories = manifest
        .hierarchy
        .iter()
        .filter_map(|node| node.territory.as_ref())
        .collect::<Vec<_>>();
    assert_eq!(territories.len(), 2);
    assert_eq!(territories[0].kind, GraphRenderTerritoryKind::Community);
    assert_eq!(territories[0].label, "Accepted name");
    assert_eq!(territories[0].community_id, Some("01".repeat(32)));
    assert_eq!(territories[1].kind, GraphRenderTerritoryKind::Unassigned);
    assert_eq!(territories[1].label, "Unassigned");
    assert!(territories[1].community_id.is_none());
    assert_ne!(territories[0].color, territories[1].color);
    let positions = &service.layout(generation).unwrap().positions;
    for (index, position) in positions.iter().enumerate() {
        let territory = territories[usize::from(index == 2)];
        let squared: f32 = (0..3)
            .map(|axis| (position[axis] - territory.center[axis]).powi(2))
            .sum();
        assert!(squared.sqrt() < territory.radius);
    }
    let empty = service
        .prepare(GraphRenderSource::new(
            "owner",
            None,
            vec![],
            vec![],
            vec![],
        ))
        .unwrap();
    assert!(
        service
            .manifest(empty.generation_id)
            .unwrap()
            .hierarchy
            .iter()
            .all(|node| node.territory.is_none())
    );
}

#[test]
fn prepared_generation_owns_manifest_and_encoded_leaf_payloads() {
    let mut service = GraphRenderService::default();
    let summary = service
        .prepare(GraphRenderSource::new(
            "owner-a",
            Some(9_007_199_254_740_993),
            memories(3),
            vec![relation(1, 2), relation(2, 3)],
            vec![],
        ))
        .unwrap();

    let manifest = service.manifest(summary.generation_id).unwrap();
    assert_eq!(
        manifest.schema_version,
        GRAPH_RENDER_MANIFEST_SCHEMA_VERSION
    );
    assert_eq!(manifest.generation_id, summary.generation_id.to_string());
    assert_eq!(manifest.owner_id, "owner-a");
    assert_eq!(
        manifest.source_community_generation.as_deref(),
        Some("9007199254740993"),
    );
    assert_eq!(manifest.total_node_count, 3);
    assert_eq!(manifest.root_hierarchy_id, 0);
    assert_eq!(manifest.edge_chunks.len(), 1);
    assert_eq!(manifest.edge_chunks[0].lod, GraphRenderEdgeLod::Detail);
    assert_eq!(manifest.edge_chunks[0].segment_count, 2);
    assert_eq!(manifest.node_chunks.len(), 1);

    let leaf = manifest
        .hierarchy
        .iter()
        .find(|node| node.kind == GraphRenderHierarchyKind::Leaf)
        .unwrap();
    assert_eq!(leaf.chunk_id, Some(0));
    assert_eq!(leaf.bounds, manifest.node_chunks[0].bounds);
    assert_eq!(leaf.node_count, manifest.node_chunks[0].node_count);

    let bytes = service.node_chunk(summary.generation_id, 0).unwrap();
    let decoded = GraphRenderNodeChunk::decode(bytes).unwrap();
    assert_eq!(decoded.generation_id, summary.generation_id);
    assert_eq!(decoded.render_ids.len(), 3);

    let edge_bytes = service.edge_chunk(summary.generation_id, 0).unwrap();
    let edge_chunk = GraphRenderEdgeChunk::decode(edge_bytes).unwrap();
    assert_eq!(edge_chunk.generation_id, summary.generation_id);
    assert_eq!(edge_chunk.endpoints.len(), 2);
}

#[test]
fn stale_and_unknown_chunk_access_fail_closed() {
    let mut service = GraphRenderService::default();
    let first = service
        .prepare(GraphRenderSource::new(
            "owner",
            Some(1),
            memories(1),
            vec![],
            vec![],
        ))
        .unwrap();
    let second = service
        .prepare(GraphRenderSource::new(
            "owner",
            Some(2),
            memories(2),
            vec![],
            vec![],
        ))
        .unwrap();

    assert_eq!(
        service.manifest(first.generation_id),
        Err(GraphRenderError::GenerationUnavailable(first.generation_id)),
    );
    assert_eq!(
        service.node_chunk(first.generation_id, 0),
        Err(GraphRenderError::GenerationUnavailable(first.generation_id)),
    );
    assert_eq!(
        service.node_chunk(second.generation_id, 99),
        Err(GraphRenderError::NodeChunkUnavailable {
            generation_id: second.generation_id,
            chunk_id: 99,
        }),
    );
    assert_eq!(
        service.edge_chunk(first.generation_id, 0),
        Err(GraphRenderError::GenerationUnavailable(first.generation_id)),
    );
    assert_eq!(
        service.edge_chunk(second.generation_id, 99),
        Err(GraphRenderError::EdgeChunkUnavailable {
            generation_id: second.generation_id,
            chunk_id: 99,
        }),
    );
}

#[test]
fn invalid_relation_does_not_replace_live_generation() {
    let mut service = GraphRenderService::default();
    let live = service
        .prepare(GraphRenderSource::new(
            "owner",
            Some(1),
            memories(1),
            vec![],
            vec![],
        ))
        .unwrap();
    let invalid =
        GraphRenderSource::new("owner", Some(2), memories(1), vec![relation(1, 9)], vec![]);

    assert_eq!(
        service.prepare(invalid),
        Err(GraphRenderError::RelationNodeUnavailable(memory_id(9))),
    );
    assert_eq!(service.latest_generation("owner"), Some(&live));
    assert!(service.manifest(live.generation_id).is_ok());
}

fn relation(source: u8, target: u8) -> GraphRenderRelationSource {
    GraphRenderRelationSource {
        source: memory_id(source),
        target: memory_id(target),
        style: style_for_relation(RelationKind::Topical, RelationOrigin::Dream),
    }
}

fn memories(count: u8) -> Vec<GraphRenderNodeSource> {
    (1..=count)
        .map(|value| {
            GraphRenderNodeSource::new(
                memory_id(value),
                format!("Memory {value}"),
                GraphRenderNodeTarget::new("memory", memory_id(value).0),
            )
        })
        .collect()
}

fn memory_id(value: u8) -> GraphRenderNodeKey {
    let mut bytes = [0_u8; 32];
    bytes[31] = value;
    GraphRenderNodeKey::new(bytes.to_vec())
}
