use crate::graph_render_source_style::{edge_color, edge_weight_units, style_for_relation};
use crate::graph_render_style::{
    edge_weight_from_units, node_color_from_degree, node_size_from_degree,
};
use reliquary_memory::{RelationKind, RelationOrigin};

#[test]
fn degree_colors_match_the_existing_knowledge_graph_palette() {
    assert_eq!(node_color_from_degree(0), 0xff60_50ff);
    assert_eq!(node_color_from_degree(1), 0xff60_50ff);
    assert_eq!(node_color_from_degree(2), 0xffa0_60ff);
    assert_eq!(node_color_from_degree(4), 0xffe0_80ff);
    assert_eq!(node_color_from_degree(7), 0xfff0_c0ff);
    assert_eq!(node_color_from_degree(13), 0xe8e8_ffff);
    assert_eq!(node_color_from_degree(26), 0xc0d0_ffff);
    assert_eq!(node_color_from_degree(50), 0x80a0_ffff);
}

#[test]
fn degree_size_matches_existing_formula_and_caps_at_four_point_five() {
    assert!((node_size_from_degree(0) - 1.32).abs() < 0.0001);
    assert!((node_size_from_degree(2) - 1.74).abs() < 0.0001);
    assert!(node_size_from_degree(10_000) <= 4.5);
    assert_eq!(node_size_from_degree(u32::MAX), 4.5);
}

#[test]
fn edge_colors_preserve_existing_relation_palette_and_user_override() {
    assert_eq!(
        edge_color(RelationKind::Topical, RelationOrigin::Dream),
        0x38bd_f8ff,
    );
    assert_eq!(
        edge_color(RelationKind::Causal, RelationOrigin::Perception),
        0xfb92_3cff,
    );
    assert_eq!(
        edge_color(RelationKind::Topical, RelationOrigin::User),
        0xc084_fcff,
    );
}

#[test]
fn edge_weight_units_preserve_kind_weight_and_user_strength() {
    let topical = edge_weight_units(RelationKind::Topical, RelationOrigin::Dream);
    let causal = edge_weight_units(RelationKind::Causal, RelationOrigin::Dream);
    let user = edge_weight_units(RelationKind::Topical, RelationOrigin::User);

    assert!((edge_weight_from_units(topical as u64) - 0.9).abs() < 0.0001);
    assert!((edge_weight_from_units(causal as u64) - 1.9).abs() < 0.0001);
    assert!((edge_weight_from_units(user as u64) - 1.215).abs() < 0.0001);
}
#[test]
fn reliquary_style_preserves_detail_sampler_discriminator_and_user_override() {
    for (kind, dream_color, base_weight) in [
        (RelationKind::Topical, 0x38bd_f8ff, 90),
        (RelationKind::Factual, 0x2dd4_bfff, 160),
        (RelationKind::Causal, 0xfb92_3cff, 190),
        (RelationKind::Recurrent, 0xe879_f9ff, 110),
        (RelationKind::References, 0x06b6_d4ff, 135),
        (RelationKind::DuplicateOf, 0xf59e_0bff, 320),
        (RelationKind::Supersedes, 0xfb71_85ff, 280),
        (RelationKind::StructuralParent, 0xa3e6_35ff, 220),
    ] {
        for origin in [
            RelationOrigin::Dream,
            RelationOrigin::Perception,
            RelationOrigin::User,
        ] {
            let style = style_for_relation(kind, origin);
            assert_eq!(style.packed_color, edge_color(kind, origin));
            assert_eq!(style.weight_units, edge_weight_units(kind, origin));
            assert_eq!(
                style.packed_color,
                if matches!(origin, RelationOrigin::User) {
                    0xc084_fcff
                } else {
                    dream_color
                }
            );
            assert_eq!(
                style.weight_units,
                base_weight
                    * if matches!(origin, RelationOrigin::User) {
                        135
                    } else {
                        100
                    }
            );
            assert_eq!(
                style.detail_priority_tag,
                ((expected_kind_code(kind) as u64) << 16)
                    ^ ((expected_origin_code(origin) as u64) << 8)
            );
        }
    }
    assert_eq!(
        style_for_relation(RelationKind::Topical, RelationOrigin::User).packed_color,
        0xc084_fcff
    );
}

fn expected_kind_code(kind: RelationKind) -> u16 {
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

fn expected_origin_code(origin: RelationOrigin) -> u8 {
    match origin {
        RelationOrigin::Dream => 1,
        RelationOrigin::User => 2,
        RelationOrigin::Perception => 3,
    }
}
