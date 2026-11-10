use crate::graph_render_contract::{GraphRenderBounds, GraphRenderHierarchyKind};
use crate::graph_render_edge_projection_model::GraphRenderLayoutTopology;
use crate::graph_render_hierarchy_model::GraphRenderHierarchy;
use crate::graph_render_layout_grid::{
    GRAPH_RENDER_CHILD_GAP, GRAPH_RENDER_NODE_RADIUS, GRAPH_RENDER_NODE_SPACING, grid_offset,
    grid_sphere_extent,
};
use crate::graph_render_layout_model::{GraphRenderLayout, GraphRenderLayoutNode, empty_bounds};
use std::collections::BTreeMap;

/// Hard limits for the local solver. Each population considers at most 128²
/// candidate pairs once, then reuses only nearby-grid pairs for 12 iterations.
/// Each node considers at most 16 weighted neighbors. Aggregate groups keep 32
/// neighbors and refine groups of at most 32 representatives for four steps;
/// each representative moves at most six units inside the 24-unit base gap.
pub(crate) const GRAPH_RENDER_LAYOUT_MAX_LOCAL_POPULATION: usize = 128;
pub(crate) const GRAPH_RENDER_LAYOUT_MAX_ITERATIONS: usize = 12;
pub(crate) const GRAPH_RENDER_LAYOUT_MAX_NEIGHBORS: usize = 16;
pub(crate) const GRAPH_RENDER_LAYOUT_MAX_AGGREGATE_FANOUT: usize = 32;
const GRAPH_RENDER_LAYOUT_MAX_CENTER_POPULATION: usize = 32;
const GRAPH_RENDER_LAYOUT_CENTER_ITERATIONS: usize = 4;
const GRAPH_RENDER_LAYOUT_MAX_CENTER_SHIFT: f32 = 6.0;
const GRAPH_RENDER_LAYOUT_CENTER_CLEARANCE: f32 = GRAPH_RENDER_CHILD_GAP * 0.5;

pub(crate) fn build_graph_render_layout(
    hierarchy: &GraphRenderHierarchy,
    node_count: u32,
) -> GraphRenderLayout {
    build_graph_render_layout_with_topology(
        hierarchy,
        node_count,
        &GraphRenderLayoutTopology::default(),
    )
}

pub(crate) fn build_graph_render_layout_with_topology(
    hierarchy: &GraphRenderHierarchy,
    node_count: u32,
    topology: &GraphRenderLayoutTopology,
) -> GraphRenderLayout {
    if hierarchy.nodes.is_empty() {
        return GraphRenderLayout {
            positions: vec![[0.0; 3]; node_count as usize],
            hierarchy: vec![],
        };
    }

    let sibling_edges = sibling_connectivity(hierarchy, topology, node_count as usize);
    let children = children_by_parent(hierarchy, &sibling_edges);
    let local_extents = local_extents(hierarchy, &children);
    let mut centers = hierarchy_centers(&children, &local_extents);
    refine_hierarchy_centers(&mut centers, &local_extents, &children, &sibling_edges);
    let mut positions = vec![[0.0; 3]; node_count as usize];

    for leaf in &hierarchy.leaves {
        let center = centers[leaf.hierarchy_id as usize];
        let ordered_render_ids = order_leaf_by_connectivity(leaf, topology);
        for (local_index, render_id) in ordered_render_ids.iter().enumerate() {
            let offset = grid_offset(
                local_index,
                ordered_render_ids.len(),
                GRAPH_RENDER_NODE_SPACING,
            );
            positions[render_id.get() as usize] = add(center, offset);
        }
        refine_leaf_positions(&ordered_render_ids, &mut positions, topology);
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

fn children_by_parent(
    hierarchy: &GraphRenderHierarchy,
    sibling_edges: &[BTreeMap<u32, Vec<(u32, u64)>>],
) -> Vec<Vec<u32>> {
    let mut children = vec![Vec::new(); hierarchy.nodes.len()];
    for node in hierarchy.nodes.iter().skip(1) {
        let parent_id = node.parent_id.expect("non-root hierarchy node has parent");
        children[parent_id as usize].push(node.id);
    }
    for (parent_id, child_ids) in children.iter_mut().enumerate() {
        if child_ids.len() < 2 {
            continue;
        }
        let mut remaining = child_ids
            .iter()
            .copied()
            .collect::<std::collections::BTreeSet<_>>();
        let mut ordered = Vec::with_capacity(child_ids.len());
        let mut current = *remaining.first().expect("nonempty child set");
        while !remaining.is_empty() {
            remaining.remove(&current);
            ordered.push(current);
            let next = sibling_edges[parent_id]
                .get(&current)
                .and_then(|neighbors| {
                    neighbors
                        .iter()
                        .find(|(candidate, _)| remaining.contains(candidate))
                        .map(|(candidate, _)| *candidate)
                })
                .or_else(|| remaining.first().copied());
            let Some(next) = next else { break };
            current = next;
        }
        *child_ids = ordered;
    }
    children
}

fn sibling_connectivity(
    hierarchy: &GraphRenderHierarchy,
    topology: &GraphRenderLayoutTopology,
    node_count: usize,
) -> Vec<BTreeMap<u32, Vec<(u32, u64)>>> {
    let mut leaf_by_render = vec![u32::MAX; node_count];
    let mut leaf_paths = Vec::with_capacity(hierarchy.leaves.len());
    for (leaf_slot, leaf) in hierarchy.leaves.iter().enumerate() {
        let mut path = Vec::new();
        let mut current = leaf.hierarchy_id;
        while let Some(parent) = hierarchy.nodes[current as usize].parent_id {
            path.push((parent, current));
            current = parent;
        }
        leaf_paths.push(path);
        for render_id in &leaf.render_ids {
            leaf_by_render[render_id.get() as usize] = leaf_slot as u32;
        }
    }
    let mut edges = vec![BTreeMap::new(); hierarchy.nodes.len()];
    for source in 0..node_count {
        for neighbor in topology.neighbors(source) {
            let target = neighbor.render_id as usize;
            if source >= target || target >= node_count {
                continue;
            }
            if leaf_by_render[source] == leaf_by_render[target] {
                continue;
            }
            let source_path = &leaf_paths[leaf_by_render[source] as usize];
            let target_path = &leaf_paths[leaf_by_render[target] as usize];
            for (parent, source_child) in &source_path {
                if let Some((_, target_child)) = target_path
                    .iter()
                    .find(|(candidate, _)| candidate == parent)
                {
                    if source_child != target_child {
                        let pair = (
                            (*source_child).min(*target_child),
                            (*source_child).max(*target_child),
                        );
                        let total: &mut u64 = edges[*parent as usize].entry(pair).or_default();
                        *total = total.saturating_add(neighbor.weight_units);
                    }
                }
            }
        }
    }
    edges
        .into_iter()
        .map(|parent_edges| {
            let mut neighbors = BTreeMap::<u32, Vec<(u32, u64)>>::new();
            for ((left, right), weight) in parent_edges {
                neighbors.entry(left).or_default().push((right, weight));
                neighbors.entry(right).or_default().push((left, weight));
            }
            for adjacent in neighbors.values_mut() {
                adjacent.sort_unstable_by(|left, right| {
                    right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0))
                });
                adjacent.truncate(GRAPH_RENDER_LAYOUT_MAX_AGGREGATE_FANOUT);
            }
            neighbors
        })
        .collect()
}

fn order_leaf_by_connectivity(
    leaf: &crate::graph_render_hierarchy_model::GraphRenderLeaf,
    topology: &GraphRenderLayoutTopology,
) -> Vec<crate::graph_render_identity::RenderNodeId> {
    if leaf.render_ids.len() < 2 {
        return leaf.render_ids.clone();
    }
    let mut remaining = leaf
        .render_ids
        .iter()
        .map(|render_id| render_id.get())
        .collect::<std::collections::BTreeSet<_>>();
    let mut ordered = Vec::with_capacity(leaf.render_ids.len());
    let mut current = *remaining.first().expect("nonempty leaf");
    while !remaining.is_empty() {
        remaining.remove(&current);
        ordered.push(crate::graph_render_identity::RenderNodeId::new(current));
        let next = topology
            .neighbors(current as usize)
            .iter()
            .filter(|neighbor| remaining.contains(&neighbor.render_id))
            .max_by(|left, right| {
                left.weight_units
                    .cmp(&right.weight_units)
                    .then_with(|| right.render_id.cmp(&left.render_id))
            })
            .map(|neighbor| neighbor.render_id)
            .or_else(|| remaining.first().copied());
        let Some(next) = next else { break };
        current = next;
    }
    ordered
}

fn refine_leaf_positions(
    ordered_render_ids: &[crate::graph_render_identity::RenderNodeId],
    positions: &mut [[f32; 3]],
    topology: &GraphRenderLayoutTopology,
) {
    for population in ordered_render_ids.chunks(GRAPH_RENDER_LAYOUT_MAX_LOCAL_POPULATION) {
        if population.len() < 2 {
            continue;
        }
        let start = 0;
        let mut links = Vec::new();
        for (source_local, render_id) in population.iter().enumerate() {
            let source = render_id.get() as usize;
            for neighbor in strongest_local_neighbors(source, population, topology) {
                let target_local = population
                    .binary_search_by_key(&neighbor.render_id, |candidate| candidate.get())
                    .expect("local neighbor belongs to the current population");
                if source < neighbor.render_id as usize {
                    links.push((source_local, target_local, neighbor.weight_units));
                }
            }
        }
        if links.is_empty() {
            continue;
        }
        let mut local_positions = population
            .iter()
            .map(|render_id| positions[render_id.get() as usize])
            .collect::<Vec<_>>();
        let repulsion_pairs = nearby_repulsion_pairs(&local_positions);
        for _ in 0..GRAPH_RENDER_LAYOUT_MAX_ITERATIONS {
            let mut force = vec![[0.0_f32; 3]; population.len()];
            for &(source, target, weight) in &links {
                apply_attraction(&mut force, start, source, target, weight, &local_positions);
            }
            for &(left, right) in &repulsion_pairs {
                apply_repulsion(&mut force, left, right, &local_positions);
            }
            for (position, delta) in local_positions.iter_mut().zip(force) {
                let length = length(delta);
                let scale = if length > 0.35 { 0.35 / length } else { 1.0 };
                for axis in 0..3 {
                    position[axis] += delta[axis] * scale;
                }
            }
        }
        for (render_id, position) in population.iter().zip(local_positions) {
            positions[render_id.get() as usize] = position;
        }
    }
}

fn strongest_local_neighbors(
    source: usize,
    population: &[crate::graph_render_identity::RenderNodeId],
    topology: &GraphRenderLayoutTopology,
) -> Vec<crate::graph_render_edge_projection_model::GraphRenderLayoutNeighbor> {
    let mut selected = Vec::with_capacity(GRAPH_RENDER_LAYOUT_MAX_NEIGHBORS);
    for neighbor in topology.neighbors(source) {
        if population
            .binary_search_by_key(&neighbor.render_id, |candidate| candidate.get())
            .is_err()
        {
            continue;
        }
        let insert_at = selected
            .iter()
            .position(
                |current: &crate::graph_render_edge_projection_model::GraphRenderLayoutNeighbor| {
                    neighbor.weight_units > current.weight_units
                        || (neighbor.weight_units == current.weight_units
                            && neighbor.render_id < current.render_id)
                },
            )
            .unwrap_or(selected.len());
        if insert_at < GRAPH_RENDER_LAYOUT_MAX_NEIGHBORS {
            selected.insert(insert_at, *neighbor);
            selected.truncate(GRAPH_RENDER_LAYOUT_MAX_NEIGHBORS);
        }
    }
    selected
}

fn apply_attraction(
    force: &mut [[f32; 3]],
    population_start: usize,
    source: usize,
    target: usize,
    weight_units: u64,
    positions: &[[f32; 3]],
) {
    let source_local = source - population_start;
    let target_local = target - population_start;
    let delta = subtract(positions[target_local], positions[source_local]);
    let distance = length(delta);
    if distance <= f32::EPSILON {
        return;
    }
    let strength = (weight_units as f32 / (weight_units as f32 + 160.0)).clamp(0.2, 0.8);
    let target_distance = 2.0 + 1.7 / (1.0 + weight_units as f32 / 160.0);
    let amount = (distance - target_distance) * strength * 0.12;
    let unit = scale(delta, 1.0 / distance);
    add_to(&mut force[source_local], scale(unit, amount));
    add_to(&mut force[target_local], scale(unit, -amount));
}

fn apply_repulsion(force: &mut [[f32; 3]], left: usize, right: usize, positions: &[[f32; 3]]) {
    let delta = subtract(positions[right], positions[left]);
    let distance = length(delta);
    if distance >= 2.1 {
        return;
    }
    if distance <= f32::EPSILON {
        // The base grid avoids coincident points; this branch is deterministic protection
        // against future layout seeds that do not.
        let axis = ((left.wrapping_mul(31) + right) % 3) as usize;
        force[left][axis] -= 0.05;
        force[right][axis] += 0.05;
        return;
    }
    let amount = (2.1 - distance) * 0.2;
    let unit = scale(delta, 1.0 / distance);
    add_to(&mut force[left], scale(unit, -amount));
    add_to(&mut force[right], scale(unit, amount));
}

const MAX_LOCAL_DISPLACEMENT: f32 = 0.35 * GRAPH_RENDER_LAYOUT_MAX_ITERATIONS as f32;

fn nearby_repulsion_pairs(positions: &[[f32; 3]]) -> Vec<(usize, usize)> {
    let mut pairs = Vec::new();
    for left in 0..positions.len() {
        for right in (left + 1)..positions.len() {
            if length(subtract(positions[right], positions[left])) <= 6.0 {
                pairs.push((left, right));
            }
        }
    }
    pairs
}

fn add_to(target: &mut [f32; 3], delta: [f32; 3]) {
    for axis in 0..3 {
        target[axis] += delta[axis];
    }
}

fn subtract(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

fn scale(value: [f32; 3], factor: f32) -> [f32; 3] {
    [value[0] * factor, value[1] * factor, value[2] * factor]
}

fn length(value: [f32; 3]) -> f32 {
    (value[0] * value[0] + value[1] * value[1] + value[2] * value[2]).sqrt()
}

fn local_extents(hierarchy: &GraphRenderHierarchy, children: &[Vec<u32>]) -> Vec<f32> {
    let mut extents = vec![GRAPH_RENDER_NODE_RADIUS; hierarchy.nodes.len()];
    for node in hierarchy.nodes.iter().rev() {
        let index = node.id as usize;
        if node.kind == GraphRenderHierarchyKind::Leaf {
            extents[index] =
                grid_sphere_extent(node.node_count as usize, GRAPH_RENDER_NODE_SPACING)
                    + GRAPH_RENDER_NODE_RADIUS
                    + MAX_LOCAL_DISPLACEMENT;
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
        extents[index] = grid_sphere_extent(child_ids.len(), spacing)
            + child_extent
            + GRAPH_RENDER_LAYOUT_MAX_CENTER_SHIFT;
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

fn refine_hierarchy_centers(
    centers: &mut [[f32; 3]],
    extents: &[f32],
    children: &[Vec<u32>],
    sibling_edges: &[BTreeMap<u32, Vec<(u32, u64)>>],
) {
    for (parent_id, child_ids) in children.iter().enumerate() {
        for population in child_ids.chunks(GRAPH_RENDER_LAYOUT_MAX_CENTER_POPULATION) {
            if population.len() < 2 {
                continue;
            }
            let slot_by_id = population
                .iter()
                .enumerate()
                .map(|(slot, child_id)| (*child_id, slot))
                .collect::<BTreeMap<_, _>>();
            let mut links = BTreeMap::<(usize, usize), u64>::new();
            for child_id in population {
                let Some(neighbors) = sibling_edges[parent_id].get(child_id) else {
                    continue;
                };
                let source = slot_by_id[child_id];
                for (neighbor, weight) in neighbors {
                    let Some(&target) = slot_by_id.get(neighbor) else {
                        continue;
                    };
                    if source == target {
                        continue;
                    }
                    let pair = (source.min(target), source.max(target));
                    links
                        .entry(pair)
                        .and_modify(|current| *current = (*current).max(*weight))
                        .or_insert(*weight);
                }
            }
            if links.is_empty() {
                continue;
            }

            let original = population
                .iter()
                .map(|child_id| centers[*child_id as usize])
                .collect::<Vec<_>>();
            let mut local = original.clone();
            let local_extents = population
                .iter()
                .map(|child_id| extents[*child_id as usize])
                .collect::<Vec<_>>();
            for _ in 0..GRAPH_RENDER_LAYOUT_CENTER_ITERATIONS {
                let mut force = vec![[0.0_f32; 3]; population.len()];
                for (&(left, right), &weight) in &links {
                    let minimum = local_extents[left]
                        + local_extents[right]
                        + GRAPH_RENDER_LAYOUT_CENTER_CLEARANCE;
                    apply_center_attraction(&mut force, left, right, weight, minimum, &local);
                }
                for left in 0..local.len() {
                    for right in (left + 1)..local.len() {
                        apply_center_repulsion(
                            &mut force,
                            left,
                            right,
                            local_extents[left] + local_extents[right],
                            &local,
                        );
                    }
                }
                for (index, (position, delta)) in local.iter_mut().zip(force).enumerate() {
                    let step = length(delta);
                    let factor = if step > 2.0 { 2.0 / step } else { 1.0 };
                    let mut candidate = add(*position, scale(delta, factor));
                    let displacement = subtract(candidate, original[index]);
                    let displacement_length = length(displacement);
                    if displacement_length > GRAPH_RENDER_LAYOUT_MAX_CENTER_SHIFT {
                        candidate = add(
                            original[index],
                            scale(
                                displacement,
                                GRAPH_RENDER_LAYOUT_MAX_CENTER_SHIFT / displacement_length,
                            ),
                        );
                    }
                    *position = candidate;
                }
            }
            for (child_id, center) in population.iter().zip(local) {
                centers[*child_id as usize] = center;
            }
        }
    }
}

fn apply_center_attraction(
    force: &mut [[f32; 3]],
    left: usize,
    right: usize,
    weight_units: u64,
    minimum_distance: f32,
    centers: &[[f32; 3]],
) {
    let delta = subtract(centers[right], centers[left]);
    let distance = length(delta);
    if distance <= minimum_distance || distance <= f32::EPSILON {
        return;
    }
    let strength = (weight_units as f32 / (weight_units as f32 + 320.0)).clamp(0.05, 0.65);
    let amount = (distance - minimum_distance) * strength * 0.15;
    let unit = scale(delta, 1.0 / distance);
    add_to(&mut force[left], scale(unit, amount));
    add_to(&mut force[right], scale(unit, -amount));
}

fn apply_center_repulsion(
    force: &mut [[f32; 3]],
    left: usize,
    right: usize,
    minimum_distance: f32,
    centers: &[[f32; 3]],
) {
    let delta = subtract(centers[right], centers[left]);
    let distance = length(delta);
    if distance >= minimum_distance {
        return;
    }
    if distance <= f32::EPSILON {
        let axis = (left.wrapping_mul(31).wrapping_add(right) % 3) as usize;
        force[left][axis] -= 0.1;
        force[right][axis] += 0.1;
        return;
    }
    let unit = scale(delta, 1.0 / distance);
    let amount = (minimum_distance - distance) * 0.25;
    add_to(&mut force[left], scale(unit, -amount));
    add_to(&mut force[right], scale(unit, amount));
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
