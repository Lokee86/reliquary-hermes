#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) struct RenderNodeId(u32);

impl RenderNodeId {
    pub(crate) const fn new(value: u32) -> Self {
        Self(value)
    }

    pub(crate) const fn get(self) -> u32 {
        self.0
    }
}

/// Stable, source-local identity independent of repository or memory domains.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) struct GraphRenderNodeKey(pub(crate) Vec<u8>);
impl GraphRenderNodeKey {
    pub(crate) fn new(value: impl Into<Vec<u8>>) -> Self {
        Self(value.into())
    }
}
/// Opaque selection target; its source adapter alone interprets its payload.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct GraphRenderNodeTarget {
    pub(crate) kind: String,
    pub(crate) value: Vec<u8>,
}
impl GraphRenderNodeTarget {
    pub(crate) fn new(kind: impl Into<String>, value: impl Into<Vec<u8>>) -> Self {
        Self {
            kind: kind.into(),
            value: value.into(),
        }
    }
}
