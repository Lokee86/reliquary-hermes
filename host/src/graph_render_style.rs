pub(crate) const GRAPH_RENDER_DEFAULT_ALPHA: u8 = 0xff;

/// All edge presentation and stable detail-sampling information is supplied by the producer.
/// `detail_priority_tag` is an opaque, deterministic source-local discriminator.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) struct GraphRenderEdgeStyle {
    pub(crate) detail_priority_tag: u64,
    pub(crate) packed_color: u32,
    pub(crate) weight_units: u32,
}

impl GraphRenderEdgeStyle {
    pub(crate) const fn new(
        packed_color: u32,
        weight_units: u32,
        detail_priority_tag: u64,
    ) -> Self {
        Self {
            detail_priority_tag,
            packed_color,
            weight_units,
        }
    }
}

pub(crate) const GRAPH_RENDER_EDGE_WEIGHT_SCALE: f32 = 10_000.0;

pub(crate) fn node_size_from_degree(degree: u32) -> f32 {
    (0.9 + ((degree as f32 + 2.0).log2() * 0.42)).min(4.5)
}

pub(crate) const fn node_color_from_degree(degree: u32) -> u32 {
    let rgb = if degree >= 50 {
        0x80a0ff
    } else if degree >= 26 {
        0xc0d0ff
    } else if degree >= 13 {
        0xe8e8ff
    } else if degree >= 7 {
        0xfff0c0
    } else if degree >= 4 {
        0xffe080
    } else if degree >= 2 {
        0xffa060
    } else {
        0xff6050
    };
    (rgb << 8) | GRAPH_RENDER_DEFAULT_ALPHA as u32
}

pub(crate) fn edge_weight_from_units(units: u64) -> f32 {
    units as f32 / GRAPH_RENDER_EDGE_WEIGHT_SCALE
}
