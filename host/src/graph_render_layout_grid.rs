pub(crate) const GRAPH_RENDER_NODE_SPACING: f32 = 4.0;
pub(crate) const GRAPH_RENDER_NODE_RADIUS: f32 = 1.0;
pub(crate) const GRAPH_RENDER_CHILD_GAP: f32 = 24.0;

pub(crate) fn grid_dimensions(count: usize) -> [usize; 3] {
    if count == 0 {
        return [1, 1, 1];
    }
    let side = ceil_cuberoot(count);
    let x = side.min(count);
    let yz = count.div_ceil(x);
    let y = side.min(yz);
    let z = yz.div_ceil(y);
    [x, y, z]
}

pub(crate) fn grid_offset(index: usize, count: usize, spacing: f32) -> [f32; 3] {
    let [width, height, depth] = grid_dimensions(count);
    let x = index % width;
    let y = (index / width) % height;
    let z = index / (width * height);
    [
        centered_axis(x, width, spacing),
        centered_axis(y, height, spacing),
        centered_axis(z, depth, spacing),
    ]
}

pub(crate) fn grid_sphere_extent(count: usize, spacing: f32) -> f32 {
    let dimensions = grid_dimensions(count);
    let half_x = dimensions[0].saturating_sub(1) as f32 * spacing * 0.5;
    let half_y = dimensions[1].saturating_sub(1) as f32 * spacing * 0.5;
    let half_z = dimensions[2].saturating_sub(1) as f32 * spacing * 0.5;
    (half_x * half_x + half_y * half_y + half_z * half_z).sqrt()
}

fn centered_axis(index: usize, count: usize, spacing: f32) -> f32 {
    let center = (count.saturating_sub(1)) as f32 * 0.5;
    (index as f32 - center) * spacing
}

fn ceil_cuberoot(value: usize) -> usize {
    let mut side = 1_usize;
    while side.saturating_mul(side).saturating_mul(side) < value {
        side += 1;
    }
    side
}
