use crate::graph_render_style::{GRAPH_RENDER_DEFAULT_ALPHA, GraphRenderEdgeStyle};
use reliquary_memory::{RelationKind, RelationOrigin};

/// Relation styling is a Reliquary source-adapter concern, not a renderer concern.
pub(crate) fn style_for_relation(
    kind: RelationKind,
    origin: RelationOrigin,
) -> GraphRenderEdgeStyle {
    let detail_priority_tag =
        ((kind_code(kind) as u64) << 16) ^ ((origin_code(origin) as u64) << 8);
    GraphRenderEdgeStyle::new(
        edge_color(kind, origin),
        edge_weight_units(kind, origin),
        detail_priority_tag,
    )
}

const fn kind_code(kind: RelationKind) -> u16 {
    match kind {
        RelationKind::Topical => 1,
        RelationKind::Factual => 2,
        RelationKind::Causal => 3,
        RelationKind::Recurrent => 4,
        RelationKind::References => 5,
        RelationKind::DuplicateOf => 6,
        RelationKind::Supersedes => 7,
        RelationKind::StructuralParent => 8,
        RelationKind::EntityAssociation => 100,
        RelationKind::PrincipalAssociation => 101,
    }
}

const fn origin_code(origin: RelationOrigin) -> u8 {
    match origin {
        RelationOrigin::Dream => 1,
        RelationOrigin::User => 2,
        RelationOrigin::Perception => 3,
    }
}

pub(crate) const fn edge_color(kind: RelationKind, origin: RelationOrigin) -> u32 {
    let rgb = if matches!(origin, RelationOrigin::User) {
        0xc084fc
    } else {
        match kind {
            RelationKind::Topical => 0x38bdf8,
            RelationKind::Factual => 0x2dd4bf,
            RelationKind::Causal => 0xfb923c,
            RelationKind::Recurrent => 0xe879f9,
            RelationKind::References => 0x06b6d4,
            RelationKind::DuplicateOf => 0xf59e0b,
            RelationKind::Supersedes => 0xfb7185,
            RelationKind::StructuralParent => 0xa3e635,
            RelationKind::EntityAssociation => 0x818cf8,
            RelationKind::PrincipalAssociation => 0xc084fc,
        }
    };
    (rgb << 8) | GRAPH_RENDER_DEFAULT_ALPHA as u32
}

pub(crate) const fn edge_weight_units(kind: RelationKind, origin: RelationOrigin) -> u32 {
    let base = match kind {
        RelationKind::Topical => 90,
        RelationKind::Recurrent => 110,
        RelationKind::References => 135,
        RelationKind::Factual => 160,
        RelationKind::Causal => 190,
        RelationKind::StructuralParent => 220,
        RelationKind::Supersedes => 280,
        RelationKind::DuplicateOf => 320,
        RelationKind::EntityAssociation => 170,
        RelationKind::PrincipalAssociation => 200,
    };
    base * if matches!(origin, RelationOrigin::User) {
        135
    } else {
        100
    }
}
