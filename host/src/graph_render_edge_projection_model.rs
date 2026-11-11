use crate::graph_render_identity::RenderNodeId;
use crate::graph_render_style::GraphRenderEdgeStyle;
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) struct GraphRenderDetailEdge {
    pub(crate) source: RenderNodeId,
    pub(crate) target: RenderNodeId,
    pub(crate) style: GraphRenderEdgeStyle,
    pub(crate) cross_community: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct GraphRenderEdgeAggregate {
    pub(crate) weight_units: u64,
    pub(crate) red_sum: u64,
    pub(crate) green_sum: u64,
    pub(crate) blue_sum: u64,
    pub(crate) count: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct GraphRenderLayoutNeighbor {
    pub(crate) render_id: u32,
    pub(crate) weight_units: u64,
}

/// Undirected, deduplicated weighted adjacency used only by the bounded layout solver.
/// The row for render ID `n` is `neighbors[offsets[n]..offsets[n + 1]]`.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct GraphRenderLayoutTopology {
    pub(crate) offsets: Vec<usize>,
    pub(crate) neighbors: Vec<GraphRenderLayoutNeighbor>,
}

impl GraphRenderLayoutTopology {
    pub(crate) fn neighbors(&self, render_id: usize) -> &[GraphRenderLayoutNeighbor] {
        let Some(start) = self.offsets.get(render_id).copied() else {
            return &[];
        };
        let Some(end) = self.offsets.get(render_id + 1).copied() else {
            return &[];
        };
        &self.neighbors[start..end]
    }

    pub(crate) fn fingerprint(&self) -> u64 {
        // FNV-1a is used here instead of DefaultHasher so an equivalent generation has
        // a stable layout key across processes and toolchain versions.
        let mut hash = 0xcbf2_9ce4_8422_2325_u64;
        for byte in b"graph-render-weighted-layout-v1" {
            hash_byte(&mut hash, *byte);
        }
        hash_u64(&mut hash, self.offsets.len().saturating_sub(1) as u64);
        for source in 0..self.offsets.len().saturating_sub(1) {
            for neighbor in self.neighbors(source) {
                if source < neighbor.render_id as usize {
                    hash_u64(&mut hash, source as u64);
                    hash_u64(&mut hash, neighbor.render_id as u64);
                    hash_u64(&mut hash, neighbor.weight_units);
                }
            }
        }
        hash
    }
}

fn hash_u64(hash: &mut u64, value: u64) {
    for byte in value.to_le_bytes() {
        hash_byte(hash, byte);
    }
}

fn hash_byte(hash: &mut u64, byte: u8) {
    *hash ^= byte as u64;
    *hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
}

impl GraphRenderEdgeAggregate {
    pub(crate) fn add(&mut self, packed_color: u32, weight_units: u32) {
        self.weight_units = self.weight_units.saturating_add(weight_units as u64);
        self.red_sum = self
            .red_sum
            .saturating_add(((packed_color >> 24) & 0xff) as u64);
        self.green_sum = self
            .green_sum
            .saturating_add(((packed_color >> 16) & 0xff) as u64);
        self.blue_sum = self
            .blue_sum
            .saturating_add(((packed_color >> 8) & 0xff) as u64);
        self.count = self.count.saturating_add(1);
    }

    pub(crate) fn packed_color(self) -> u32 {
        if self.count == 0 {
            return 0xffff_ffff;
        }
        let red = self.red_sum / self.count;
        let green = self.green_sum / self.count;
        let blue = self.blue_sum / self.count;
        ((red as u32) << 24) | ((green as u32) << 16) | ((blue as u32) << 8) | 0xff
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct GraphRenderEdgeProjection {
    pub(crate) degrees: Vec<u32>,
    pub(crate) layout_topology: GraphRenderLayoutTopology,
    pub(crate) overview: BTreeMap<(u32, u32), GraphRenderEdgeAggregate>,
    pub(crate) intermediate: BTreeMap<(u32, u32), GraphRenderEdgeAggregate>,
    pub(crate) detail_by_leaf: Vec<Vec<GraphRenderDetailEdge>>,
}
