use crate::graph_render_contract::GraphRenderBounds;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct GraphRenderLayoutNode {
    pub(crate) center: [f32; 3],
    pub(crate) bounds: GraphRenderBounds,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GraphRenderLayout {
    pub(crate) positions: Vec<[f32; 3]>,
    pub(crate) hierarchy: Vec<GraphRenderLayoutNode>,
}

impl GraphRenderLayout {
    pub(crate) fn global_bounds(&self) -> GraphRenderBounds {
        self.hierarchy
            .first()
            .map(|node| node.bounds)
            .unwrap_or_else(empty_bounds)
    }
}

pub(crate) fn empty_bounds() -> GraphRenderBounds {
    GraphRenderBounds::new([-1.0, -1.0, -1.0], [1.0, 1.0, 1.0])
}
