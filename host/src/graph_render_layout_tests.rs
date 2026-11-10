use crate::graph_render_contract::GraphRenderBounds;
use crate::graph_render_error::GraphRenderError;
use crate::graph_render_hierarchy::build_graph_render_hierarchy;
use crate::graph_render_identity::{GraphRenderNodeKey, GraphRenderNodeTarget};
use crate::graph_render_layout::build_graph_render_layout;
use crate::graph_render_layout_grid::{
    GRAPH_RENDER_CHILD_GAP, GRAPH_RENDER_NODE_RADIUS, GRAPH_RENDER_NODE_SPACING,
};
use crate::graph_render_source::GraphRenderCommunitySource;

#[test]
fn production_layout_constants_are_frozen() {
    assert_eq!(GRAPH_RENDER_NODE_SPACING, 4.0);
    assert_eq!(GRAPH_RENDER_NODE_RADIUS, 1.0);
    assert_eq!(GRAPH_RENDER_CHILD_GAP, 24.0);
}

#[test]
fn empty_graph_layout_is_finite_and_bounded() {
    let hierarchy = build_graph_render_hierarchy(&[], vec![], 2, 2).unwrap();
    let layout = build_graph_render_layout(&hierarchy, 0);

    assert!(layout.positions.is_empty());
    assert_eq!(layout.hierarchy.len(), 1);
    assert_eq!(
        layout.global_bounds(),
        GraphRenderBounds::new([-1.0; 3], [1.0; 3]),
    );
}

#[test]
fn one_leaf_uses_deterministic_centered_node_grid() {
    let memories = (1..=5).map(memory_id).collect::<Vec<_>>();
    let hierarchy = build_graph_render_hierarchy(&memories, vec![], 8, 2).unwrap();

    let first = build_graph_render_layout(&hierarchy, memories.len() as u32);
    let second = build_graph_render_layout(&hierarchy, memories.len() as u32);

    assert_eq!(first, second);
    assert_eq!(
        first.positions,
        vec![
            [-2.0, -2.0, -2.0],
            [2.0, -2.0, -2.0],
            [-2.0, 2.0, -2.0],
            [2.0, 2.0, -2.0],
            [-2.0, -2.0, 2.0],
        ],
    );
    assert_eq!(
        first.global_bounds(),
        GraphRenderBounds::new([-3.0, -3.0, -3.0], [3.0, 3.0, 3.0]),
    );
}

#[test]
fn sibling_territories_are_separated_without_force_simulation() {
    let memories = vec![memory_id(1), memory_id(2)];
    let hierarchy = build_graph_render_hierarchy(
        &memories,
        vec![
            community(1, vec![memory_id(1)]),
            community(2, vec![memory_id(2)]),
        ],
        8,
        2,
    )
    .unwrap();
    let layout = build_graph_render_layout(&hierarchy, 2);

    assert_eq!(layout.positions, vec![[-13.0, 0.0, 0.0], [13.0, 0.0, 0.0]]);
    assert_eq!(
        layout.global_bounds(),
        GraphRenderBounds::new([-14.0, -1.0, -1.0], [14.0, 1.0, 1.0]),
    );
}

#[test]
fn every_hierarchy_bound_contains_its_children_and_leaf_nodes() {
    let memories = (1..=9).map(memory_id).collect::<Vec<_>>();
    let hierarchy =
        build_graph_render_hierarchy(&memories, vec![community(1, memories[..7].to_vec())], 2, 2)
            .unwrap();
    let layout = build_graph_render_layout(&hierarchy, memories.len() as u32);

    for node in &hierarchy.nodes {
        let bounds = layout.hierarchy[node.id as usize].bounds;
        assert!(
            bounds
                .min
                .iter()
                .chain(bounds.max.iter())
                .all(|value| value.is_finite())
        );
        if let Some(parent_id) = node.parent_id {
            assert_contains(layout.hierarchy[parent_id as usize].bounds, bounds);
        }
    }

    for leaf in &hierarchy.leaves {
        let bounds = layout.hierarchy[leaf.hierarchy_id as usize].bounds;
        for render_id in &leaf.render_ids {
            assert_contains_point(bounds, layout.positions[render_id.get() as usize]);
        }
    }
}

#[test]
fn stale_generation_layout_fails_closed() {
    use crate::graph_render::GraphRenderService;
    use crate::graph_render_source::{GraphRenderNodeSource, GraphRenderSource};

    let mut service = GraphRenderService::default();
    let first = service
        .prepare(GraphRenderSource::new(
            "owner",
            Some(1),
            vec![GraphRenderNodeSource::new(
                memory_id(1),
                "one",
                GraphRenderNodeTarget::new("memory", memory_id(1).0),
            )],
            vec![],
            vec![],
        ))
        .unwrap();
    service
        .prepare(GraphRenderSource::new(
            "owner",
            Some(2),
            vec![GraphRenderNodeSource::new(
                memory_id(2),
                "two",
                GraphRenderNodeTarget::new("memory", memory_id(2).0),
            )],
            vec![],
            vec![],
        ))
        .unwrap();

    assert_eq!(
        service.layout(first.generation_id),
        Err(GraphRenderError::GenerationUnavailable(first.generation_id)),
    );
}

fn assert_contains(outer: GraphRenderBounds, inner: GraphRenderBounds) {
    for axis in 0..3 {
        assert!(outer.min[axis] <= inner.min[axis]);
        assert!(outer.max[axis] >= inner.max[axis]);
    }
}

fn assert_contains_point(bounds: GraphRenderBounds, point: [f32; 3]) {
    for axis in 0..3 {
        assert!(bounds.min[axis] <= point[axis]);
        assert!(bounds.max[axis] >= point[axis]);
    }
}

fn community(id: u8, members: Vec<GraphRenderNodeKey>) -> GraphRenderCommunitySource {
    GraphRenderCommunitySource::new(memory_id(id).0.try_into().unwrap(), members)
}

fn memory_id(value: u8) -> GraphRenderNodeKey {
    let mut bytes = [0_u8; 32];
    bytes[31] = value;
    GraphRenderNodeKey::new(bytes.to_vec())
}
