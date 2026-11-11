use crate::graph_render_contract::{GraphRenderBounds, GraphRenderHierarchyKind};
use crate::graph_render_edge_projection_model::GraphRenderLayoutTopology;
use crate::graph_render_hierarchy_model::GraphRenderHierarchy;
use crate::graph_render_layout_model::{GraphRenderLayout, GraphRenderLayoutNode, empty_bounds};
use crate::graph_render_style::{edge_weight_from_units, node_size_from_degree};
use std::collections::{BTreeMap, BTreeSet, HashMap};

/// The global node pass keeps at most 16 weighted neighbors per node and visits
/// at most 64 nearby collision candidates per node per iteration. Coarse groups
/// keep at most 32 weighted neighbors and use the same bounded spatial lookup.
const FORCE_ITERATIONS: usize = 30;
const GROUP_FORCE_ITERATIONS: usize = 140;
const MAX_FORCE_NEIGHBORS: usize = 16;
const MAX_UNASSIGNED_LOCALITY: usize = 128;
const MAX_GROUP_NEIGHBORS: usize = 32;
const MAX_REPULSION_CANDIDATES: usize = 64;
pub(crate) const GRAPH_RENDER_NODE_RADIUS: f32 = 1.0;

#[cfg(test)]
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
    let degrees = (0..node_count as usize)
        .map(|render_id| topology.neighbors(render_id).len() as u32)
        .collect::<Vec<_>>();
    build_graph_render_layout_with_degrees(hierarchy, node_count, topology, &degrees)
}

pub(crate) fn build_graph_render_layout_with_degrees(
    hierarchy: &GraphRenderHierarchy,
    node_count: u32,
    topology: &GraphRenderLayoutTopology,
    degrees: &[u32],
) -> GraphRenderLayout {
    if hierarchy.nodes.is_empty() {
        return GraphRenderLayout {
            positions: vec![[0.0; 3]; node_count as usize],
            hierarchy: vec![],
        };
    }

    // The hierarchy remains the chunking/annotation structure. It does not partition
    // the solver: every weighted edge, including cross-leaf and cross-community edges,
    // participates in this single continuous 3D layout.
    let (groups, group_by_render) = visual_groups(hierarchy, topology, node_count as usize);
    let mut links = strongest_links(topology, node_count as usize);
    links.sort_unstable_by_key(|&(left, right, _)| (left, right));
    let node_radii = (0..node_count as usize)
        .map(|render_id| {
            let degree = degrees.get(render_id).copied().unwrap_or(0);
            (node_size_from_degree(degree) * 0.8).max(1.0)
        })
        .collect::<Vec<_>>();
    let semantic_group_count = hierarchy
        .nodes
        .iter()
        .filter(|node| {
            node.kind == GraphRenderHierarchyKind::Territory && node.source_community_id.is_some()
        })
        .count();
    let mut local_slot_by_render = vec![usize::MAX; node_count as usize];
    for members in &groups {
        for (slot, &render_id) in members.iter().enumerate() {
            local_slot_by_render[render_id] = slot;
        }
    }
    let mut local_links = vec![Vec::<(usize, usize, u64)>::new(); groups.len()];
    for &(left, right, weight) in &links {
        let group = group_by_render[left];
        if group == group_by_render[right] {
            local_links[group].push((
                local_slot_by_render[left],
                local_slot_by_render[right],
                weight,
            ));
        }
    }
    let local_layouts = groups
        .iter()
        .enumerate()
        .map(|(group, members)| {
            let local_radii = members
                .iter()
                .map(|&render_id| node_radii[render_id])
                .collect::<Vec<_>>();
            layout_local_members(
                members,
                &local_radii,
                &local_links[group],
                node_count <= 10_000,
            )
        })
        .collect::<Vec<_>>();
    let local_group_radii = groups
        .iter()
        .zip(&local_layouts)
        .map(|(members, local)| {
            members
                .iter()
                .zip(local)
                .map(|(&render_id, point)| length(*point) + node_radii[render_id])
                .fold(0.0_f32, f32::max)
                + 6.0
        })
        .collect::<Vec<_>>();
    let group_centers = layout_group_centers(
        &groups,
        &group_by_render,
        semantic_group_count,
        &local_group_radii,
        topology,
    );
    let mut positions = vec![[0.0; 3]; node_count as usize];
    for (group_id, members) in groups.iter().enumerate() {
        for (slot, &render_id) in members.iter().enumerate() {
            // Keep the coarse visual region legible while leaving individual nodes
            // free to cross it under real relation forces in the global pass.
            positions[render_id] = add(group_centers[group_id], local_layouts[group_id][slot]);
        }
    }
    let mut velocities = vec![[0.0_f32; 3]; positions.len()];
    let node_iterations = match positions.len() {
        0..=100_000 => FORCE_ITERATIONS,
        100_001..=500_000 => 8,
        _ => 4,
    };
    for iteration in 0..node_iterations {
        let mut forces = vec![[0.0_f32; 3]; positions.len()];
        for &(left, right, weight) in &links {
            if group_by_render[left] != group_by_render[right] {
                apply_cross_group_attraction(
                    &mut forces,
                    left,
                    right,
                    weight,
                    &positions,
                    &node_radii,
                );
            }
        }
        apply_spatial_repulsion(&positions, &node_radii, 1.1, &mut forces, false);
        let cooling = 1.0 - 0.55 * iteration as f32 / node_iterations as f32;
        for ((position, velocity), force) in positions.iter_mut().zip(&mut velocities).zip(forces) {
            *velocity = scale(add(*velocity, force), 0.8);
            let magnitude = length(*velocity);
            let max_step = 1.4 * cooling;
            if magnitude > max_step {
                *velocity = scale(*velocity, max_step / magnitude);
            }
            *position = add(*position, *velocity);
        }
        recenter_groups(&mut positions, &group_centers, &groups);
    }
    let centers = hierarchy_centroids(hierarchy, node_count as usize, &positions);
    let children = children_by_parent(hierarchy, &vec![BTreeMap::new(); hierarchy.nodes.len()]);
    let bounds = hierarchy_bounds(hierarchy, &children, &centers, &positions, &node_radii);
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

/// Authoritative communities each get one coarse layout body. Null-membership
/// nodes are split only into deterministic topology-locality bodies; these IDs
/// never leave the layout and do not alter semantic membership.
fn visual_groups(
    hierarchy: &GraphRenderHierarchy,
    topology: &GraphRenderLayoutTopology,
    node_count: usize,
) -> (Vec<Vec<usize>>, Vec<usize>) {
    let mut territories = hierarchy
        .nodes
        .iter()
        .filter(|node| node.kind == GraphRenderHierarchyKind::Territory)
        .collect::<Vec<_>>();
    territories.sort_unstable_by_key(|node| node.id);
    let mut groups = Vec::<Vec<usize>>::new();
    let mut group_for_territory = BTreeMap::<u32, usize>::new();
    for territory in &territories {
        if territory.source_community_id.is_some() {
            let group = groups.len();
            groups.push(Vec::new());
            group_for_territory.insert(territory.id, group);
        }
    }
    let mut group_by_render = vec![usize::MAX; node_count];
    let mut unassigned = BTreeSet::new();
    for leaf in &hierarchy.leaves {
        let mut current = Some(leaf.hierarchy_id);
        let mut territory_id = None;
        while let Some(id) = current {
            if hierarchy.nodes[id as usize].kind == GraphRenderHierarchyKind::Territory {
                territory_id = Some(id);
                break;
            }
            current = hierarchy.nodes[id as usize].parent_id;
        }
        let group = territory_id.and_then(|id| group_for_territory.get(&id).copied());
        for render_id in &leaf.render_ids {
            let render_id = render_id.get() as usize;
            if let Some(group) = group {
                groups[group].push(render_id);
                group_by_render[render_id] = group;
            } else {
                unassigned.insert(render_id);
            }
        }
    }
    for members in &mut groups {
        members.sort_unstable();
    }
    while let Some(&seed) = unassigned.first() {
        unassigned.remove(&seed);
        let mut members = vec![seed];
        let mut cursor = 0;
        while cursor < members.len() && members.len() < MAX_UNASSIGNED_LOCALITY {
            let source = members[cursor];
            let mut neighbors = topology
                .neighbors(source)
                .iter()
                .take(MAX_REPULSION_CANDIDATES)
                .filter(|neighbor| unassigned.contains(&(neighbor.render_id as usize)))
                .copied()
                .collect::<Vec<_>>();
            neighbors.sort_unstable_by(|a, b| {
                b.weight_units
                    .cmp(&a.weight_units)
                    .then_with(|| a.render_id.cmp(&b.render_id))
            });
            for neighbor in neighbors {
                if members.len() == MAX_UNASSIGNED_LOCALITY {
                    break;
                }
                let target = neighbor.render_id as usize;
                if unassigned.remove(&target) {
                    members.push(target);
                }
            }
            cursor += 1;
        }
        members.sort_unstable();
        let group = groups.len();
        for &render_id in &members {
            group_by_render[render_id] = group;
        }
        groups.push(members);
    }
    // Defensive coverage for malformed/partial hierarchy input.
    for render_id in 0..node_count {
        if group_by_render[render_id] == usize::MAX {
            let group = groups.len();
            group_by_render[render_id] = group;
            groups.push(vec![render_id]);
        }
    }
    (groups, group_by_render)
}

fn layout_group_centers(
    groups: &[Vec<usize>],
    group_by_render: &[usize],
    semantic_group_count: usize,
    radii: &[f32],
    topology: &GraphRenderLayoutTopology,
) -> Vec<[f32; 3]> {
    if groups.is_empty() {
        return Vec::new();
    }
    // The original 32-unit group clearance belongs to named community bodies.
    // Visual-only unassigned locality bodies use node-scale clearance so a large
    // number of singleton nodes cannot inflate the coarse-world volume.
    let clearances = (0..groups.len())
        .map(|index| {
            if index < semantic_group_count {
                16.0
            } else {
                1.0
            }
        })
        .collect::<Vec<_>>();
    let masses = groups
        .iter()
        .map(|members| 1.0 + (members.len() as f32).cbrt())
        .collect::<Vec<_>>();
    let occupied_volume = radii
        .iter()
        .enumerate()
        .map(|(index, radius)| (radius + clearances[index]).powi(3))
        .sum::<f32>();
    let initial_radius = (70.0_f32 * 1.5).max(occupied_volume.cbrt() * 1.4);
    let mut centers = initial_positions_with_radius(groups.len(), initial_radius);
    let adjacency = bounded_group_adjacency(groups.len(), group_by_render, topology);
    let mut bounded_links = BTreeMap::<(usize, usize), u64>::new();
    for (left, neighbors) in adjacency.iter().enumerate() {
        for (&right, &weight) in neighbors {
            let pair = (left.min(right), left.max(right));
            bounded_links
                .entry(pair)
                .and_modify(|current| *current = (*current).max(weight))
                .or_insert(weight);
        }
    }
    let group_links = bounded_links.into_iter().collect::<Vec<_>>();
    let group_iterations = match groups.len() {
        0..=10_000 => GROUP_FORCE_ITERATIONS,
        10_001..=100_000 => 8,
        _ => 4,
    };
    let mut velocities = vec![[0.0; 3]; groups.len()];
    for iteration in 0..group_iterations {
        let mut force = vec![[0.0; 3]; groups.len()];
        for &((left, right), weight_units) in &group_links {
            let delta = subtract(centers[right], centers[left]);
            let distance = length(delta);
            if distance <= f32::EPSILON {
                continue;
            }
            let weight = edge_weight_from_units(weight_units);
            let effective = (1.0 + weight.max(0.0).ln_1p()).sqrt();
            let desired = radii[left]
                + radii[right]
                + clearances[left]
                + clearances[right]
                + 70.0 / effective;
            let amount = (distance - desired) * 0.019 * effective.min(4.0);
            let pull = scale(delta, amount / distance);
            add_to(&mut force[left], pull);
            add_to(&mut force[right], scale(pull, -1.0));
        }
        apply_group_repulsion(&centers, &radii, &clearances, &masses, &mut force);
        let cooling = 1.0 - 0.55 * iteration as f32 / group_iterations as f32;
        for (index, ((center, velocity), delta)) in centers
            .iter_mut()
            .zip(&mut velocities)
            .zip(force)
            .enumerate()
        {
            let gravity = scale(*center, -0.0024 * masses[index]);
            *velocity = scale(
                add(*velocity, scale(add(delta, gravity), 1.0 / masses[index])),
                0.84,
            );
            let magnitude = length(*velocity);
            let max_step = 18.0 * cooling;
            if magnitude > max_step {
                *velocity = scale(*velocity, max_step / magnitude);
            }
            *center = add(*center, *velocity);
        }
        recenter_weighted(&mut centers, &masses);
    }
    centers
}

pub(crate) fn bounded_group_adjacency(
    group_count: usize,
    group_by_render: &[usize],
    topology: &GraphRenderLayoutTopology,
) -> Vec<BTreeMap<usize, u64>> {
    let mut aggregate_weights = BTreeMap::<(usize, usize), u64>::new();
    for source in 0..group_by_render.len() {
        for neighbor in topology.neighbors(source) {
            let target = neighbor.render_id as usize;
            if source >= target || target >= group_by_render.len() {
                continue;
            }
            let left = group_by_render[source];
            let right = group_by_render[target];
            if left == right {
                continue;
            }
            let pair = (left.min(right), left.max(right));
            let weight = aggregate_weights.entry(pair).or_default();
            *weight = weight.saturating_add(neighbor.weight_units);
        }
    }
    let mut adjacency = vec![BTreeMap::<usize, u64>::new(); group_count];
    for ((left, right), weight) in aggregate_weights {
        retain_group_neighbor(&mut adjacency[left], right, weight);
        retain_group_neighbor(&mut adjacency[right], left, weight);
    }
    adjacency
}

fn retain_group_neighbor(neighbors: &mut BTreeMap<usize, u64>, candidate: usize, weight: u64) {
    if let Some(current) = neighbors.get_mut(&candidate) {
        *current = current.saturating_add(weight);
        return;
    }
    if neighbors.len() < MAX_GROUP_NEIGHBORS {
        neighbors.insert(candidate, weight);
        return;
    }
    let weakest = neighbors
        .iter()
        .min_by(|(left_id, left_weight), (right_id, right_weight)| {
            left_weight
                .cmp(right_weight)
                .then_with(|| right_id.cmp(left_id))
        })
        .map(|(&id, &weight)| (id, weight));
    if let Some((weakest_id, weakest_weight)) = weakest {
        if weight > weakest_weight || (weight == weakest_weight && candidate < weakest_id) {
            neighbors.remove(&weakest_id);
            neighbors.insert(candidate, weight);
        }
    }
}

pub(crate) fn apply_group_repulsion(
    centers: &[[f32; 3]],
    radii: &[f32],
    clearances: &[f32],
    masses: &[f32],
    force: &mut [[f32; 3]],
) {
    if centers.len() < 2 {
        return;
    }
    if centers.len() <= 220 {
        for left in 0..centers.len() {
            for right in (left + 1)..centers.len() {
                let delta = subtract(centers[right], centers[left]);
                let distance = length(delta);
                let direction = if distance <= f32::EPSILON {
                    let axis = (left.wrapping_mul(31).wrapping_add(right)) % 3;
                    let mut vector = [0.0; 3];
                    vector[axis] = 1.0;
                    vector
                } else {
                    scale(delta, 1.0 / distance)
                };
                let minimum = radii[left] + radii[right] + clearances[left] + clearances[right];
                let amount = if distance < minimum {
                    (minimum - distance) * 0.34
                } else {
                    650.0 * (masses[left] * masses[right]).sqrt() / (distance * distance + 1.0)
                };
                add_to(&mut force[left], scale(direction, -amount));
                add_to(&mut force[right], scale(direction, amount));
            }
        }
        return;
    }
    let cell_size = (radii.iter().copied().fold(0.0_f32, f32::max) * 2.0
        + clearances.iter().copied().fold(0.0_f32, f32::max) * 2.0)
        .max(4.0);
    let mut cells = HashMap::<(i32, i32, i32), Vec<usize>>::new();
    let coords = centers
        .iter()
        .map(|p| {
            (
                (p[0] / cell_size).floor() as i32,
                (p[1] / cell_size).floor() as i32,
                (p[2] / cell_size).floor() as i32,
            )
        })
        .collect::<Vec<_>>();
    for (index, key) in coords.iter().copied().enumerate() {
        cells.entry(key).or_default().push(index);
    }
    for (left, &(x, y, z)) in coords.iter().enumerate() {
        for right in sample_spatial_candidates(left, (x, y, z), &cells) {
            let delta = subtract(centers[right], centers[left]);
            let distance = length(delta);
            let minimum = radii[left] + radii[right] + clearances[left] + clearances[right];
            if distance >= minimum {
                continue;
            }
            let direction = pair_direction(left, right, delta, distance);
            let amount = if distance <= f32::EPSILON {
                1.0
            } else {
                (minimum - distance) * 0.25
            };
            add_to(&mut force[left], scale(direction, -amount));
        }
    }
}

fn initial_positions(count: usize) -> Vec<[f32; 3]> {
    // Render IDs are assigned from sorted node keys, so this is stable across runs
    // and independent of relation iteration order.
    let radius = (count.max(1) as f32).cbrt() * 2.94;
    initial_positions_with_radius(count, radius)
}

fn initial_positions_with_radius(count: usize, radius: f32) -> Vec<[f32; 3]> {
    let golden = 2.399_963_1_f32;
    (0..count)
        .map(|index| {
            let fraction = (index as f32 + 0.5) / count.max(1) as f32;
            let z = 1.0 - 2.0 * fraction;
            let ring = (1.0 - z * z).max(0.0).sqrt();
            let phase = stable_phase(index as u64);
            let angle = index as f32 * golden + phase;
            let shell = fraction.cbrt() * radius;
            [
                angle.cos() * ring * shell,
                angle.sin() * ring * shell,
                z * shell,
            ]
        })
        .collect()
}

fn stable_phase(seed: u64) -> f32 {
    let mut value = seed.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^= value >> 31;
    (value as u32) as f32 / u32::MAX as f32 * std::f32::consts::TAU
}

fn strongest_links(topology: &GraphRenderLayoutTopology, count: usize) -> Vec<(usize, usize, u64)> {
    let mut links = BTreeMap::<(usize, usize), u64>::new();
    for source in 0..count {
        let mut selected = Vec::with_capacity(MAX_FORCE_NEIGHBORS);
        for neighbor in topology.neighbors(source) {
            if neighbor.render_id as usize >= count || neighbor.render_id as usize == source {
                continue;
            }
            let insert_at = selected
                .iter()
                .position(|candidate: &&crate::graph_render_edge_projection_model::GraphRenderLayoutNeighbor| {
                    neighbor.weight_units > candidate.weight_units
                        || (neighbor.weight_units == candidate.weight_units
                            && neighbor.render_id < candidate.render_id)
                })
                .unwrap_or(selected.len());
            if insert_at < MAX_FORCE_NEIGHBORS {
                selected.insert(insert_at, neighbor);
                selected.truncate(MAX_FORCE_NEIGHBORS);
            }
        }
        for neighbor in selected {
            let target = neighbor.render_id as usize;
            let pair = (source.min(target), source.max(target));
            links
                .entry(pair)
                .and_modify(|weight| *weight = (*weight).max(neighbor.weight_units))
                .or_insert(neighbor.weight_units);
        }
    }
    links
        .into_iter()
        .map(|((left, right), weight)| (left, right, weight))
        .collect()
}

fn apply_weighted_attraction(
    force: &mut [[f32; 3]],
    left: usize,
    right: usize,
    weight_units: u64,
    positions: &[[f32; 3]],
    radii: &[f32],
    padding: f32,
    attraction: f32,
) {
    let delta = subtract(positions[right], positions[left]);
    let distance = length(delta);
    if distance <= f32::EPSILON {
        return;
    }
    let weight = edge_weight_from_units(weight_units);
    let effective_weight = 1.0 + weight.max(0.0).ln_1p();
    let effective = effective_weight.sqrt();
    let desired = radii[left] + radii[right] + padding + 4.5 / effective;
    let amount = (distance - desired) * attraction * effective.min(4.0);
    let pull = scale(delta, amount / distance);
    add_to(&mut force[left], pull);
    add_to(&mut force[right], scale(pull, -1.0));
}

fn apply_cross_group_attraction(
    force: &mut [[f32; 3]],
    left: usize,
    right: usize,
    weight_units: u64,
    positions: &[[f32; 3]],
    radii: &[f32],
) {
    // Coarse centers already encode cross-group relationship strength. This pass
    // only nudges linked boundary nodes while group recentering holds those centers.
    apply_weighted_attraction(
        force,
        left,
        right,
        weight_units,
        positions,
        radii,
        1.1,
        0.006,
    );
}

fn layout_local_members(
    members: &[usize],
    radii: &[f32],
    links: &[(usize, usize, u64)],
    exact_pair_forces: bool,
) -> Vec<[f32; 3]> {
    let count = members.len();
    if count == 0 {
        return Vec::new();
    }
    if count == 1 {
        return vec![[0.0; 3]];
    }
    let occupied_volume = radii
        .iter()
        .map(|radius| (radius + 1.1).powi(3))
        .sum::<f32>();
    let initial_radius = (4.5_f32 * 1.5).max(occupied_volume.cbrt() * 1.4);
    let mut positions = initial_positions_with_radius(count, initial_radius);
    let iterations = if count > 500 {
        18
    } else if count < 30 {
        42
    } else {
        FORCE_ITERATIONS
    };
    let mut velocities = vec![[0.0_f32; 3]; count];
    for iteration in 0..iterations {
        let mut forces = vec![[0.0_f32; 3]; count];
        for &(left, right, weight) in links {
            apply_weighted_attraction(
                &mut forces,
                left,
                right,
                weight,
                &positions,
                radii,
                1.1,
                0.055,
            );
        }
        apply_spatial_repulsion(
            &positions,
            radii,
            1.1,
            &mut forces,
            count <= 220 && exact_pair_forces,
        );
        let cooling = 1.0 - 0.55 * iteration as f32 / iterations as f32;
        for ((position, velocity), force) in positions.iter_mut().zip(&mut velocities).zip(forces) {
            let gravity = scale(*position, -0.014);
            *velocity = scale(add(*velocity, add(force, gravity)), 0.8);
            let magnitude = length(*velocity);
            let max_step = 1.4 * cooling;
            if magnitude > max_step {
                *velocity = scale(*velocity, max_step / magnitude);
            }
            *position = add(*position, *velocity);
        }
        recenter(&mut positions);
    }
    positions
}

pub(crate) fn apply_spatial_repulsion(
    positions: &[[f32; 3]],
    radii: &[f32],
    padding: f32,
    force: &mut [[f32; 3]],
    long_range: bool,
) {
    if long_range && positions.len() <= 220 {
        for left in 0..positions.len() {
            for right in (left + 1)..positions.len() {
                apply_node_pair_repulsion(left, right, positions, radii, padding, force, true);
            }
        }
        return;
    }
    let max_radius = radii.iter().copied().fold(1.0_f32, f32::max);
    let cell_size = 4.5_f32.max(max_radius * 2.0 + padding);
    let mut cells = HashMap::<(i32, i32, i32), Vec<usize>>::new();
    let coords = positions
        .iter()
        .map(|p| {
            (
                (p[0] / cell_size).floor() as i32,
                (p[1] / cell_size).floor() as i32,
                (p[2] / cell_size).floor() as i32,
            )
        })
        .collect::<Vec<_>>();
    for (index, key) in coords.iter().copied().enumerate() {
        cells.entry(key).or_default().push(index);
    }
    for (left, &(x, y, z)) in coords.iter().enumerate() {
        for right in sample_spatial_candidates(left, (x, y, z), &cells) {
            apply_node_pair_repulsion(left, right, positions, radii, padding, force, false);
        }
    }
}

fn apply_node_pair_repulsion(
    left: usize,
    right: usize,
    positions: &[[f32; 3]],
    radii: &[f32],
    padding: f32,
    force: &mut [[f32; 3]],
    long_range: bool,
) {
    let delta = subtract(positions[right], positions[left]);
    let distance = length(delta);
    let minimum = radii[left] + radii[right] + padding;
    let amount = if distance < minimum {
        (minimum - distance) * 0.34
    } else if long_range {
        6.0 / (distance * distance + 1.0)
    } else if distance < minimum * 2.5 {
        6.0 * 0.08 / (distance + 1.0)
    } else {
        0.0
    };
    if amount == 0.0 {
        return;
    }
    let direction = pair_direction(left, right, delta, distance);
    add_to(&mut force[left], scale(direction, -amount));
    // In sampled large populations each node receives its own directed forces.
    // In the exact small-population pass preserve equal-and-opposite pair forces.
    if long_range {
        add_to(&mut force[right], scale(direction, amount));
    }
}

fn sample_spatial_candidates(
    index: usize,
    cell: (i32, i32, i32),
    cells: &HashMap<(i32, i32, i32), Vec<usize>>,
) -> Vec<usize> {
    let mut buckets = Vec::with_capacity(27);
    for dx in -1..=1 {
        for dy in -1..=1 {
            for dz in -1..=1 {
                if let Some(bucket) = cells.get(&(cell.0 + dx, cell.1 + dy, cell.2 + dz)) {
                    if !bucket.is_empty() {
                        buckets.push(bucket);
                    }
                }
            }
        }
    }
    if buckets.is_empty() {
        return Vec::new();
    }
    let base_quota = MAX_REPULSION_CANDIDATES / buckets.len();
    let remainder = MAX_REPULSION_CANDIDATES % buckets.len();
    let mut result = Vec::with_capacity(MAX_REPULSION_CANDIDATES);
    for (bucket_index, bucket) in buckets.into_iter().enumerate() {
        let quota = (base_quota + usize::from(bucket_index < remainder)).min(bucket.len());
        if quota == 0 {
            continue;
        }
        let rotation = index % (bucket.len() / quota).max(1);
        for sample in 0..quota {
            let slot = (sample * bucket.len() / quota + rotation) % bucket.len();
            let candidate = bucket[slot];
            if candidate != index {
                result.push(candidate);
            }
        }
    }
    result
}

fn pair_direction(left: usize, right: usize, delta: [f32; 3], distance: f32) -> [f32; 3] {
    if distance > f32::EPSILON {
        return scale(delta, 1.0 / distance);
    }
    let (low, high) = (left.min(right), left.max(right));
    let axis = (low.wrapping_mul(31).wrapping_add(high)) % 3;
    let mut direction = [0.0; 3];
    direction[axis] = if left < right { 1.0 } else { -1.0 };
    direction
}

fn recenter(positions: &mut [[f32; 3]]) {
    if positions.is_empty() {
        return;
    }
    let mut center = [0.0; 3];
    for position in positions.iter() {
        add_to(&mut center, *position);
    }
    center = scale(center, 1.0 / positions.len() as f32);
    for position in positions {
        *position = subtract(*position, center);
    }
}

fn recenter_groups(positions: &mut [[f32; 3]], centers: &[[f32; 3]], groups: &[Vec<usize>]) {
    for (group_id, members) in groups.iter().enumerate() {
        if members.is_empty() {
            continue;
        }
        let mut centroid = [0.0; 3];
        for &render_id in members {
            add_to(&mut centroid, positions[render_id]);
        }
        centroid = scale(centroid, 1.0 / members.len() as f32);
        let translation = subtract(centers[group_id], centroid);
        for &render_id in members {
            positions[render_id] = add(positions[render_id], translation);
        }
    }
}

fn recenter_weighted(positions: &mut [[f32; 3]], masses: &[f32]) {
    if positions.is_empty() {
        return;
    }
    let mut center = [0.0; 3];
    let mut total_mass = 0.0;
    for (position, mass) in positions.iter().zip(masses) {
        add_to(&mut center, scale(*position, *mass));
        total_mass += mass;
    }
    center = scale(center, 1.0 / total_mass.max(1.0));
    for position in positions {
        *position = subtract(*position, center);
    }
}

fn hierarchy_centroids(
    hierarchy: &GraphRenderHierarchy,
    count: usize,
    positions: &[[f32; 3]],
) -> Vec<[f32; 3]> {
    let mut sums = vec![[0.0; 3]; hierarchy.nodes.len()];
    let mut counts = vec![0_usize; hierarchy.nodes.len()];
    for leaf in &hierarchy.leaves {
        for id in &leaf.render_ids {
            let point = positions[id.get() as usize];
            let mut current = Some(leaf.hierarchy_id);
            while let Some(id) = current {
                add_to(&mut sums[id as usize], point);
                counts[id as usize] += 1;
                current = hierarchy.nodes[id as usize].parent_id;
            }
        }
    }
    let _ = count;
    sums.iter()
        .zip(counts)
        .map(|(sum, count)| {
            if count == 0 {
                [0.0; 3]
            } else {
                scale(*sum, 1.0 / count as f32)
            }
        })
        .collect()
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

fn hierarchy_bounds(
    hierarchy: &GraphRenderHierarchy,
    children: &[Vec<u32>],
    centers: &[[f32; 3]],
    positions: &[[f32; 3]],
    node_radii: &[f32],
) -> Vec<GraphRenderBounds> {
    let mut bounds = vec![empty_bounds(); hierarchy.nodes.len()];

    for leaf in &hierarchy.leaves {
        bounds[leaf.hierarchy_id as usize] = bounds_for_render_ids(leaf, positions, node_radii);
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
    node_radii: &[f32],
) -> GraphRenderBounds {
    let mut bounds = None;
    for render_id in &leaf.render_ids {
        let point = positions[render_id.get() as usize];
        let point_bounds = bounds_around(point, node_radii[render_id.get() as usize]);
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
