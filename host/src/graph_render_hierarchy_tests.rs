use crate::graph_render_contract::GraphRenderHierarchyKind;
use crate::graph_render_error::GraphRenderError;
use crate::graph_render_hierarchy::{
    DEFAULT_GRAPH_RENDER_LEAF_CAPACITY, GRAPH_RENDER_SUBGROUP_LEAF_FANOUT,
    build_graph_render_hierarchy,
};
use crate::graph_render_identity::{GraphRenderNodeKey, RenderNodeId};
use crate::graph_render_source::GraphRenderCommunitySource;

#[test]
fn production_hierarchy_limits_are_frozen() {
    assert_eq!(DEFAULT_GRAPH_RENDER_LEAF_CAPACITY, 32_768);
    assert_eq!(GRAPH_RENDER_SUBGROUP_LEAF_FANOUT, 32);
}

#[test]
fn empty_graph_has_only_the_root_hierarchy_node() {
    let hierarchy = build_graph_render_hierarchy(&[], vec![], 2, 2).unwrap();

    assert_eq!(hierarchy.nodes.len(), 1);
    assert_eq!(hierarchy.nodes[0].kind, GraphRenderHierarchyKind::Graph);
    assert_eq!(hierarchy.nodes[0].node_count, 0);
    assert!(hierarchy.leaves.is_empty());
}

#[test]
fn hierarchy_is_deterministic_across_source_and_member_order() {
    let left = build_graph_render_hierarchy(
        &sorted_memories(),
        vec![
            community(2, vec![memory_id(5), memory_id(2)]),
            community(1, vec![memory_id(4), memory_id(1)]),
        ],
        10,
        2,
    )
    .unwrap();
    let right = build_graph_render_hierarchy(
        &sorted_memories(),
        vec![
            community(1, vec![memory_id(1), memory_id(4)]),
            community(2, vec![memory_id(2), memory_id(5)]),
        ],
        10,
        2,
    )
    .unwrap();

    assert_eq!(left, right);
    assert_eq!(left.nodes[0].kind, GraphRenderHierarchyKind::Graph);
    assert_eq!(left.nodes[0].node_count, 5);

    let territories = left
        .nodes
        .iter()
        .filter(|node| node.kind == GraphRenderHierarchyKind::Territory)
        .collect::<Vec<_>>();
    assert_eq!(territories.len(), 3);
    assert_eq!(territories[0].source_community_id, Some(community_id(1)));
    assert_eq!(territories[1].source_community_id, Some(community_id(2)));
    assert_eq!(territories[2].source_community_id, None);

    assert_eq!(left.leaves.len(), 3);
    assert_eq!(left.leaves[0].render_ids, vec![rid(0), rid(3)]);
    assert_eq!(left.leaves[1].render_ids, vec![rid(1), rid(4)]);
    assert_eq!(left.leaves[2].render_ids, vec![rid(2)]);
}

#[test]
fn oversized_territory_splits_into_bounded_subgroups_and_leaves() {
    let memories = (1..=5).map(memory_id).collect::<Vec<_>>();
    let hierarchy =
        build_graph_render_hierarchy(&memories, vec![community(1, memories.clone())], 2, 2)
            .unwrap();

    let subgroups = hierarchy
        .nodes
        .iter()
        .filter(|node| node.kind == GraphRenderHierarchyKind::Subgroup)
        .collect::<Vec<_>>();
    assert_eq!(subgroups.len(), 2);
    assert_eq!(subgroups[0].node_count, 4);
    assert_eq!(subgroups[1].node_count, 1);

    assert_eq!(hierarchy.leaves.len(), 3);
    assert_eq!(hierarchy.leaves[0].chunk_id, 0);
    assert_eq!(hierarchy.leaves[1].chunk_id, 1);
    assert_eq!(hierarchy.leaves[2].chunk_id, 2);
    assert!(
        hierarchy
            .leaves
            .iter()
            .all(|leaf| leaf.render_ids.len() <= 2)
    );
    assert_eq!(hierarchy.leaves[0].render_ids, vec![rid(0), rid(1)]);
    assert_eq!(hierarchy.leaves[1].render_ids, vec![rid(2), rid(3)]);
    assert_eq!(hierarchy.leaves[2].render_ids, vec![rid(4)]);
}

#[test]
fn hierarchy_rejects_unknown_duplicate_and_cross_community_membership() {
    let memories = vec![memory_id(1), memory_id(2)];

    assert_eq!(
        build_graph_render_hierarchy(&memories, vec![community(1, vec![memory_id(9)])], 2, 2,),
        Err(GraphRenderError::CommunityNodeUnavailable {
            community_id: community_id(1),
            node_key: memory_id(9),
        }),
    );

    assert_eq!(
        build_graph_render_hierarchy(
            &memories,
            vec![community(1, vec![memory_id(1), memory_id(1)])],
            2,
            2,
        ),
        Err(GraphRenderError::DuplicateCommunityMember {
            community_id: community_id(1),
            node_key: memory_id(1),
        }),
    );

    assert_eq!(
        build_graph_render_hierarchy(
            &memories,
            vec![
                community(1, vec![memory_id(1)]),
                community(2, vec![memory_id(1)]),
            ],
            2,
            2,
        ),
        Err(GraphRenderError::NodeInMultipleCommunities {
            node_key: memory_id(1),
            first_community_id: community_id(1),
            second_community_id: community_id(2),
        }),
    );
}

#[test]
fn hierarchy_rejects_duplicate_community_identity() {
    assert_eq!(
        build_graph_render_hierarchy(
            &[memory_id(1)],
            vec![community(1, vec![memory_id(1)]), community(1, vec![]),],
            2,
            2,
        ),
        Err(GraphRenderError::DuplicateCommunityId(community_id(1))),
    );
}

fn sorted_memories() -> Vec<GraphRenderNodeKey> {
    (1..=5).map(memory_id).collect()
}

fn community(id: u8, members: Vec<GraphRenderNodeKey>) -> GraphRenderCommunitySource {
    GraphRenderCommunitySource::new(community_id(id), members)
}

fn community_id(value: u8) -> [u8; 32] {
    let mut bytes = [0_u8; 32];
    bytes[31] = value;
    bytes
}

fn memory_id(value: u8) -> GraphRenderNodeKey {
    GraphRenderNodeKey::new(community_id(value).to_vec())
}

fn rid(value: u32) -> RenderNodeId {
    RenderNodeId::new(value)
}
