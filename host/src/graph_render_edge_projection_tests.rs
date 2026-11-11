use crate::graph_render_edge_projection::{
    GraphRenderEdgeProjectionBuilder, build_edge_projection,
};
use crate::graph_render_error::GraphRenderError;
use crate::graph_render_hierarchy::build_graph_render_hierarchy;
use crate::graph_render_identity::GraphRenderNodeKey;
use crate::graph_render_source::{GraphRenderCommunitySource, GraphRenderRelationSource};
use crate::graph_render_source_style::style_for_relation;
use reliquary_memory::{RelationKind, RelationOrigin};

#[test]
fn projection_counts_degrees_and_separates_edge_lods() {
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
    let relations = vec![relation(1, 2), relation(2, 3), relation(3, 4)];

    let projection = build_edge_projection(&memories, &relations, &hierarchy).unwrap();

    assert_eq!(projection.degrees, vec![1, 2, 2, 1]);
    assert_eq!(projection.overview.len(), 1);
    assert_eq!(projection.intermediate.len(), 1);
    assert_eq!(projection.detail_by_leaf.len(), 2);
    assert_eq!(projection.detail_by_leaf[0].len(), 2);
    assert_eq!(projection.detail_by_leaf[1].len(), 1);
    let endpoints = projection
        .detail_by_leaf
        .iter()
        .flatten()
        .map(|edge| (edge.source.get(), edge.target.get()))
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(endpoints, [(0, 1), (1, 2), (2, 3)].into_iter().collect());
}

#[test]
fn projection_is_deterministic_under_relation_reordering() {
    let memories = memories(4);
    let hierarchy = build_graph_render_hierarchy(&memories, vec![], 4, 2).unwrap();
    let left = vec![
        relation_kind(1, 2, RelationKind::Topical),
        relation_kind(2, 3, RelationKind::Causal),
        relation_kind(3, 4, RelationKind::Factual),
    ];
    let mut right = left.clone();
    right.reverse();

    assert_eq!(
        build_edge_projection(&memories, &left, &hierarchy).unwrap(),
        build_edge_projection(&memories, &right, &hierarchy).unwrap(),
    );
}

#[test]
fn detail_selection_is_deterministically_bounded() {
    let memories = memories(6);
    let hierarchy = build_graph_render_hierarchy(&memories, vec![], 8, 2).unwrap();
    let relations = vec![
        relation(1, 2),
        relation(1, 3),
        relation(1, 4),
        relation(1, 5),
        relation(1, 6),
    ];

    let mut left = GraphRenderEdgeProjectionBuilder::new(6, &hierarchy, 2);
    for relation in &relations {
        left.push(&memories, relation).unwrap();
    }
    let mut right = GraphRenderEdgeProjectionBuilder::new(6, &hierarchy, 2);
    for relation in relations.iter().rev() {
        right.push(&memories, relation).unwrap();
    }

    let left = left.finish();
    let right = right.finish();
    assert_eq!(left, right);
    assert_eq!(left.detail_by_leaf[0].len(), 2);
    assert!(left.overview.is_empty());
    assert!(left.intermediate.is_empty());
}

#[test]
fn projection_rejects_relation_to_missing_memory() {
    let memories = memories(2);
    let hierarchy = build_graph_render_hierarchy(&memories, vec![], 2, 2).unwrap();

    assert_eq!(
        build_edge_projection(&memories, &[relation(1, 9)], &hierarchy),
        Err(GraphRenderError::RelationNodeUnavailable(memory_id(9))),
    );
}

#[test]
fn self_relation_counts_degree_without_emitting_geometry() {
    let memories = memories(1);
    let hierarchy = build_graph_render_hierarchy(&memories, vec![], 2, 2).unwrap();
    let projection = build_edge_projection(&memories, &[relation(1, 1)], &hierarchy).unwrap();

    assert_eq!(projection.degrees, vec![2]);
    assert!(projection.overview.is_empty());
    assert!(projection.intermediate.is_empty());
    assert!(projection.detail_by_leaf[0].is_empty());
}

fn relation(source: u8, target: u8) -> GraphRenderRelationSource {
    relation_kind(source, target, RelationKind::Topical)
}

fn relation_kind(source: u8, target: u8, kind: RelationKind) -> GraphRenderRelationSource {
    GraphRenderRelationSource {
        source: memory_id(source),
        target: memory_id(target),
        style: style_for_relation(kind, RelationOrigin::Dream),
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
