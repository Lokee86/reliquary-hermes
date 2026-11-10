use crate::graph_render::GraphRenderService;
use crate::graph_render_error::GraphRenderError;
use crate::graph_render_identity::{GraphRenderNodeKey, GraphRenderNodeTarget, RenderNodeId};
use crate::graph_render_source::{
    GraphRenderCommunitySource, GraphRenderNodeSource, GraphRenderSource,
};

#[test]
fn graph_render_assigns_dense_ids_in_deterministic_memory_order() {
    let mut service = GraphRenderService::default();
    let summary = service
        .prepare(GraphRenderSource::new(
            "rel-owner",
            Some(7),
            vec![memory_source(3), memory_source(1), memory_source(2)],
            vec![],
            vec![],
        ))
        .unwrap();

    assert_eq!(summary.owner_id, "rel-owner");
    assert_eq!(summary.source_community_generation, Some(7));
    assert_eq!(summary.node_count, 3);
    assert_eq!(
        service
            .resolve_node(summary.generation_id, RenderNodeId::new(0))
            .unwrap(),
        memory_target(1),
    );
    assert_eq!(
        service
            .resolve_node(summary.generation_id, RenderNodeId::new(1))
            .unwrap(),
        memory_target(2),
    );
    assert_eq!(
        service
            .resolve_node(summary.generation_id, RenderNodeId::new(2))
            .unwrap(),
        memory_target(3),
    );
}

#[test]
fn graph_render_replaces_only_the_prior_generation_for_the_same_owner() {
    let mut service = GraphRenderService::default();
    let first = service
        .prepare(source("rel-owner", 1, vec![memory_id(1)]))
        .unwrap();
    let other = service
        .prepare(source("other-owner", 2, vec![memory_id(8)]))
        .unwrap();
    let replacement = service
        .prepare(source("rel-owner", 3, vec![memory_id(2)]))
        .unwrap();

    assert_eq!(
        service.resolve_node(first.generation_id, RenderNodeId::new(0)),
        Err(GraphRenderError::GenerationUnavailable(first.generation_id)),
    );
    assert_eq!(
        service
            .resolve_node(other.generation_id, RenderNodeId::new(0))
            .unwrap(),
        memory_target(8),
    );
    assert_eq!(
        service
            .resolve_node(replacement.generation_id, RenderNodeId::new(0))
            .unwrap(),
        memory_target(2),
    );
    assert_eq!(service.latest_generation("rel-owner"), Some(&replacement));
}

#[test]
fn clearing_bounded_generation_cache_preserves_monotonic_render_ids() {
    let mut service = GraphRenderService::default();
    let first = service
        .prepare(source("rel-owner", 1, vec![memory_id(1)]))
        .unwrap();
    service.clear();
    let second = service
        .prepare(source("rel-owner", 2, vec![memory_id(2)]))
        .unwrap();
    assert!(second.generation_id > first.generation_id);
    assert_eq!(
        service.resolve_node(first.generation_id, RenderNodeId::new(0)),
        Err(GraphRenderError::GenerationUnavailable(first.generation_id)),
    );
}

#[test]
fn hierarchy_validation_failure_does_not_replace_live_generation() {
    let mut service = GraphRenderService::default();
    let live = service
        .prepare(source("rel-owner", 3, vec![memory_id(1)]))
        .unwrap();
    let invalid = GraphRenderSource::new(
        "rel-owner",
        Some(4),
        vec![memory_source(1)],
        vec![],
        vec![GraphRenderCommunitySource::new(
            community_id(9),
            vec![memory_id(2)],
        )],
    );

    assert_eq!(
        service.prepare(invalid),
        Err(GraphRenderError::CommunityNodeUnavailable {
            community_id: community_id(9),
            node_key: memory_id(2),
        }),
    );
    assert_eq!(service.latest_generation("rel-owner"), Some(&live));
    assert_eq!(
        service.hierarchy(live.generation_id).unwrap().nodes[0].node_count,
        1
    );
}

#[test]
fn invalid_render_id_fails_without_semantic_fallback() {
    let mut service = GraphRenderService::default();
    let summary = service
        .prepare(GraphRenderSource::new(
            "rel-owner",
            None,
            vec![memory_source(4)],
            vec![],
            vec![],
        ))
        .unwrap();
    let render_id = RenderNodeId::new(1);

    assert_eq!(
        service.resolve_node(summary.generation_id, render_id),
        Err(GraphRenderError::RenderNodeUnavailable {
            generation_id: summary.generation_id,
            render_id,
        }),
    );
}

#[test]
fn invalid_source_does_not_replace_the_live_generation() {
    let mut service = GraphRenderService::default();
    let live = service
        .prepare(source("rel-owner", 4, vec![memory_id(1)]))
        .unwrap();

    assert_eq!(
        service.prepare(source("rel-owner", 5, vec![memory_id(2), memory_id(2)],)),
        Err(GraphRenderError::DuplicateNodeKey(memory_id(2))),
    );
    assert_eq!(service.latest_generation("rel-owner"), Some(&live));
    assert_eq!(
        service
            .resolve_node(live.generation_id, RenderNodeId::new(0))
            .unwrap(),
        memory_target(1),
    );
}

fn source(
    owner_id: &str,
    generation: u64,
    memory_ids: Vec<GraphRenderNodeKey>,
) -> GraphRenderSource {
    GraphRenderSource::new(
        owner_id,
        Some(generation),
        memory_ids
            .into_iter()
            .map(|memory_id| {
                GraphRenderNodeSource::new(
                    memory_id.clone(),
                    "memory",
                    GraphRenderNodeTarget::new("memory", memory_id.0),
                )
            })
            .collect(),
        vec![],
        vec![],
    )
}

fn memory_source(value: u8) -> GraphRenderNodeSource {
    GraphRenderNodeSource::new(
        memory_id(value),
        format!("Memory {value}"),
        memory_target(value),
    )
}

fn memory_id(value: u8) -> GraphRenderNodeKey {
    GraphRenderNodeKey::new(community_id(value).to_vec())
}

fn community_id(value: u8) -> [u8; 32] {
    let mut bytes = [0_u8; 32];
    bytes[31] = value;
    bytes
}
fn memory_target(value: u8) -> GraphRenderNodeTarget {
    GraphRenderNodeTarget::new("memory", memory_id(value).0)
}
