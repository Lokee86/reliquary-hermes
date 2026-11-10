use crate::graph_render_contract::{GraphRenderBounds, GraphRenderHierarchyKind};
use crate::graph_render_hierarchy_model::GraphRenderHierarchy;
use crate::graph_render_layout_grid::{
    GRAPH_RENDER_CHILD_GAP, GRAPH_RENDER_NODE_RADIUS, GRAPH_RENDER_NODE_SPACING, grid_half_extent,
    grid_offset,
};
use crate::graph_render_layout_model::{GraphRenderLayout, GraphRenderLayoutNode, empty_bounds};

pub(crate) fn build_graph_render_layout(
    hierarchy: &GraphRenderHierarchy,
    node_count: u32,
) -> GraphRenderLayout {
    if hierarchy.nodes.is_empty() {
        return GraphRenderLayout {
            positions: vec![[0.0; 3]; node_count as usize],
            hierarchy: vec![],
        };
    }

    let children = children_by_parent(hierarchy);
    let local_extents = local_extents(hierarchy, &children);
    let centers = hierarchy_centers(&children, &local_extents);
    let mut positions = vec![[0.0; 3]; node_count as usize];

    for leaf in &hierarchy.leaves {
        let center = centers[leaf.hierarchy_id as usize];
        for (local_index, render_id) in leaf.render_ids.iter().enumerate() {
            let offset = grid_offset(
                local_index,
                leaf.render_ids.len(),
                GRAPH_RENDER_NODE_SPACING,
            );
            positions[render_id.get() as usize] = add(center, offset);
        }
    }

    let bounds = hierarchy_bounds(hierarchy, &children, &centers, &positions);
    let hierarchy = centers
        .into_iter()
        .zip(bounds)
        .map(|(center, bounds)| GraphRenderLayoutNode { center, bounds })
        .collect();

    GraphRenderLayout {
        positions,
        hierarchy,
    }
}

fn children_by_parent(hierarchy: &GraphRenderHierarchy) -> Vec<Vec<u32>> {
    let mut children = vec![Vec::new(); hierarchy.nodes.len()];
    for node in hierarchy.nodes.iter().skip(1) {
        let parent_id = node.parent_id.expect("non-root hierarchy node has parent");
        children[parent_id as usize].push(node.id);
    }
    children
}

fn local_extents(hierarchy: &GraphRenderHierarchy, children: &[Vec<u32>]) -> Vec<f32> {
    let mut extents = vec![GRAPH_RENDER_NODE_RADIUS; hierarchy.nodes.len()];
    for node in hierarchy.nodes.iter().rev() {
        let index = node.id as usize;
        if node.kind == GraphRenderHierarchyKind::Leaf {
            extents[index] = grid_half_extent(node.node_count as usize, GRAPH_RENDER_NODE_SPACING)
                + GRAPH_RENDER_NODE_RADIUS;
            continue;
        }

        let child_ids = &children[index];
        if child_ids.is_empty() {
            continue;
        }
        let child_extent = child_ids
            .iter()
            .map(|child_id| extents[*child_id as usize])
            .fold(0.0_f32, f32::max);
        let spacing = child_extent * 2.0 + GRAPH_RENDER_CHILD_GAP;
        extents[index] = grid_half_extent(child_ids.len(), spacing) + child_extent;
    }
    extents
}

fn hierarchy_centers(children: &[Vec<u32>], extents: &[f32]) -> Vec<[f32; 3]> {
    let mut centers = vec![[0.0; 3]; children.len()];
    for parent_id in 0..children.len() {
        let child_ids = &children[parent_id];
        if child_ids.is_empty() {
            continue;
        }
        let child_extent = child_ids
            .iter()
            .map(|child_id| extents[*child_id as usize])
            .fold(0.0_f32, f32::max);
        let spacing = child_extent * 2.0 + GRAPH_RENDER_CHILD_GAP;
        for (index, child_id) in child_ids.iter().enumerate() {
            centers[*child_id as usize] = add(
                centers[parent_id],
                grid_offset(index, child_ids.len(), spacing),
            );
        }
    }
    centers
}

fn hierarchy_bounds(
    hierarchy: &GraphRenderHierarchy,
    children: &[Vec<u32>],
    centers: &[[f32; 3]],
    positions: &[[f32; 3]],
) -> Vec<GraphRenderBounds> {
    let mut bounds = vec![empty_bounds(); hierarchy.nodes.len()];

    for leaf in &hierarchy.leaves {
        bounds[leaf.hierarchy_id as usize] = bounds_for_render_ids(leaf, positions);
    }

    for node in hierarchy.nodes.iter().rev() {
        let index = node.id as usize;
        if node.kind == GraphRenderHierarchyKind::Leaf {
            continue;
        }
        bounds[index] = union_children(&children[index], &bounds)
            .unwrap_or_else(|| bounds_around(centers[index], GRAPH_RENDER_NODE_RADIUS));
    }
    bounds
}

fn bounds_for_render_ids(
    leaf: &crate::graph_render_hierarchy_model::GraphRenderLeaf,
    positions: &[[f32; 3]],
) -> GraphRenderBounds {
    let mut bounds = None;
    for render_id in &leaf.render_ids {
        let point = positions[render_id.get() as usize];
        let point_bounds = bounds_around(point, GRAPH_RENDER_NODE_RADIUS);
        bounds = Some(match bounds {
            Some(current) => union(current, point_bounds),
            None => point_bounds,
        });
    }
    bounds.unwrap_or_else(empty_bounds)
}

fn union_children(children: &[u32], bounds: &[GraphRenderBounds]) -> Option<GraphRenderBounds> {
    children
        .iter()
        .map(|child_id| bounds[*child_id as usize])
        .reduce(union)
}

fn bounds_around(center: [f32; 3], radius: f32) -> GraphRenderBounds {
    GraphRenderBounds::new(
        [center[0] - radius, center[1] - radius, center[2] - radius],
        [center[0] + radius, center[1] + radius, center[2] + radius],
    )
}

fn union(left: GraphRenderBounds, right: GraphRenderBounds) -> GraphRenderBounds {
    GraphRenderBounds::new(
        [
            left.min[0].min(right.min[0]),
            left.min[1].min(right.min[1]),
            left.min[2].min(right.min[2]),
        ],
        [
            left.max[0].max(right.max[0]),
            left.max[1].max(right.max[1]),
            left.max[2].max(right.max[2]),
        ],
    )
}

fn add(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}
