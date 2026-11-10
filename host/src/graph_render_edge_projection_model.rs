use crate::graph_render_identity::RenderNodeId;
use crate::graph_render_style::GraphRenderEdgeStyle;
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) struct GraphRenderDetailEdge {
    pub(crate) source: RenderNodeId,
    pub(crate) target: RenderNodeId,
    pub(crate) style: GraphRenderEdgeStyle,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct GraphRenderEdgeAggregate {
    pub(crate) weight_units: u64,
    pub(crate) red_sum: u64,
    pub(crate) green_sum: u64,
    pub(crate) blue_sum: u64,
    pub(crate) count: u64,
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
    pub(crate) overview: BTreeMap<(u32, u32), GraphRenderEdgeAggregate>,
    pub(crate) intermediate: BTreeMap<(u32, u32), GraphRenderEdgeAggregate>,
    pub(crate) detail_by_leaf: Vec<Vec<GraphRenderDetailEdge>>,
}
