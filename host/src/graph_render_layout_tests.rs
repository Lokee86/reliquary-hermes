use crate::graph_render_contract::GraphRenderBounds;
use crate::graph_render_edge_projection_model::{
    GraphRenderLayoutNeighbor, GraphRenderLayoutTopology,
};
use crate::graph_render_error::GraphRenderError;
use crate::graph_render_hierarchy::build_graph_render_hierarchy;
use crate::graph_render_identity::{GraphRenderNodeKey, GraphRenderNodeTarget};
use crate::graph_render_layout::GRAPH_RENDER_NODE_RADIUS;
use crate::graph_render_layout::build_graph_render_layout;
use crate::graph_render_layout::build_graph_render_layout_with_topology;
use crate::graph_render_source::GraphRenderCommunitySource;

#[test]
fn production_layout_constants_are_frozen() {
    assert_eq!(GRAPH_RENDER_NODE_RADIUS, 1.0);
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
fn one_leaf_uses_deterministic_continuous_positions() {
    let memories = (1..=5).map(memory_id).collect::<Vec<_>>();
    let hierarchy = build_graph_render_hierarchy(&memories, vec![], 8, 2).unwrap();

    let first = build_graph_render_layout(&hierarchy, memories.len() as u32);
    let second = build_graph_render_layout(&hierarchy, memories.len() as u32);

    assert_eq!(first, second);
    assert!(
        first
            .positions
            .iter()
            .flatten()
            .all(|value| value.is_finite())
    );
    assert!(
        first
            .positions
            .iter()
            .any(|point| point.iter().any(|axis| axis.fract().abs() > 0.01))
    );
}

#[test]
fn sibling_territories_share_the_same_continuous_world() {
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

    assert!(distance(layout.positions[0], layout.positions[1]) > 0.0);
    assert!(
        layout
            .positions
            .iter()
            .flatten()
            .all(|coordinate| coordinate.is_finite())
    );
}

#[test]
fn weighted_edges_pull_connected_nodes_closer_with_deterministic_positions() {
    let memories = (1..=6).map(memory_id).collect::<Vec<_>>();
    let hierarchy = build_graph_render_hierarchy(&memories, vec![], 8, 2).unwrap();
    let weak = pair_topology(memories.len(), 9_000);
    let strong = pair_topology(memories.len(), 32_000);

    let weak_first =
        build_graph_render_layout_with_topology(&hierarchy, memories.len() as u32, &weak);
    let weak_again =
        build_graph_render_layout_with_topology(&hierarchy, memories.len() as u32, &weak);
    let strong_layout =
        build_graph_render_layout_with_topology(&hierarchy, memories.len() as u32, &strong);

    assert_eq!(weak_first, weak_again);
    assert!(
        distance(weak_first.positions[0], weak_first.positions[1])
            > distance(strong_layout.positions[0], strong_layout.positions[1],)
    );
    assert!(
        weak_first
            .positions
            .iter()
            .flatten()
            .all(|coordinate| coordinate.is_finite())
    );
}

#[test]
fn weighted_walk_keeps_cross_population_neighbors_together() {
    let memories = (1..=129).map(memory_id).collect::<Vec<_>>();
    let hierarchy = build_graph_render_hierarchy(&memories, vec![], 256, 2).unwrap();
    let mut topology = GraphRenderLayoutTopology {
        offsets: vec![0; memories.len() + 1],
        neighbors: vec![
            GraphRenderLayoutNeighbor {
                render_id: 128,
                weight_units: 30_000,
            },
            GraphRenderLayoutNeighbor {
                render_id: 0,
                weight_units: 30_000,
            },
        ],
    };
    topology.offsets[1] = 1;
    topology.offsets[129] = 2;
    for offset in 2..129 {
        topology.offsets[offset] = 1;
    }
    let layout =
        build_graph_render_layout_with_topology(&hierarchy, memories.len() as u32, &topology);

    assert!(distance(layout.positions[0], layout.positions[128]) < 3.0);
    for (index, position) in layout.positions.iter().enumerate() {
        for other in &layout.positions[index + 1..] {
            assert!(distance(*position, *other) >= GRAPH_RENDER_NODE_RADIUS * 2.0);
        }
    }
    assert!(
        layout
            .positions
            .iter()
            .flatten()
            .all(|value| value.is_finite())
    );
}

#[test]
fn changing_chunk_leaf_capacity_does_not_change_spatial_partition_or_positions() {
    let memories = (1..=130).map(memory_id).collect::<Vec<_>>();
    let many_leaves = build_graph_render_hierarchy(&memories, vec![], 64, 2).unwrap();
    let one_leaf = build_graph_render_hierarchy(&memories, vec![], 256, 2).unwrap();
    let topology = pair_topology(memories.len(), 32_000);

    let first =
        build_graph_render_layout_with_topology(&many_leaves, memories.len() as u32, &topology);
    let second =
        build_graph_render_layout_with_topology(&one_leaf, memories.len() as u32, &topology);

    assert_eq!(first.positions, second.positions);
}

#[test]
fn cross_territory_topology_places_linked_territories_adjacent() {
    let memories = (1..=3).map(memory_id).collect::<Vec<_>>();
    let hierarchy = build_graph_render_hierarchy(
        &memories,
        vec![
            community(1, vec![memory_id(1)]),
            community(2, vec![memory_id(2)]),
            community(3, vec![memory_id(3)]),
        ],
        8,
        2,
    )
    .unwrap();
    let topology = GraphRenderLayoutTopology {
        offsets: vec![0, 1, 1, 2],
        neighbors: vec![
            GraphRenderLayoutNeighbor {
                render_id: 2,
                weight_units: 32_000,
            },
            GraphRenderLayoutNeighbor {
                render_id: 0,
                weight_units: 32_000,
            },
        ],
    };
    let strong_layout =
        build_graph_render_layout_with_topology(&hierarchy, memories.len() as u32, &topology);
    let mut weak_topology = topology.clone();
    weak_topology.neighbors[0].weight_units = 9_000;
    weak_topology.neighbors[1].weight_units = 9_000;
    let weak_layout =
        build_graph_render_layout_with_topology(&hierarchy, memories.len() as u32, &weak_topology);

    let linked_distance = distance(strong_layout.positions[0], strong_layout.positions[2]);
    let weak_linked_distance = distance(weak_layout.positions[0], weak_layout.positions[2]);
    let unlinked_distance = distance(strong_layout.positions[0], strong_layout.positions[1]);
    assert!(linked_distance < unlinked_distance);
    assert!(linked_distance < weak_linked_distance);

    assert_ne!(topology.fingerprint(), weak_topology.fingerprint());
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

fn pair_topology(node_count: usize, weight_units: u64) -> GraphRenderLayoutTopology {
    let mut offsets = vec![0; node_count + 1];
    let mut neighbors = Vec::new();
    for index in 0..node_count {
        if index == 0 {
            neighbors.push(GraphRenderLayoutNeighbor {
                render_id: 1,
                weight_units,
            });
        } else if index == 1 {
            neighbors.push(GraphRenderLayoutNeighbor {
                render_id: 0,
                weight_units,
            });
        }
        offsets[index + 1] = neighbors.len();
    }
    GraphRenderLayoutTopology { offsets, neighbors }
}

fn distance(left: [f32; 3], right: [f32; 3]) -> f32 {
    ((left[0] - right[0]).powi(2) + (left[1] - right[1]).powi(2) + (left[2] - right[2]).powi(2))
        .sqrt()
}

fn community(id: u8, members: Vec<GraphRenderNodeKey>) -> GraphRenderCommunitySource {
    GraphRenderCommunitySource::new(memory_id(id).0.try_into().unwrap(), members)
}

fn memory_id(value: u8) -> GraphRenderNodeKey {
    let mut bytes = [0_u8; 32];
    bytes[31] = value;
    GraphRenderNodeKey::new(bytes.to_vec())
}
