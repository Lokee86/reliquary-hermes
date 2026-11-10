//! Bounded graph source and selection index at one authorized Root cut.

use crate::graph_render_contract::GraphRenderVec3;
use crate::graph_render_identity::{GraphRenderNodeKey, GraphRenderNodeTarget};
use crate::graph_render_source::{
    GraphRenderCommunitySource, GraphRenderNodeSource, GraphRenderRelationSource, GraphRenderSource,
};
use crate::graph_render_source_style::style_for_relation;
use crate::graph_render_style::edge_weight_from_units;
use crate::service_http::HttpError;
use reliquary_memory::{
    InspectionCut, Instance, MemoryListFilters, NodeRef, OwnerId, OwnerKind, RelationKind,
    RelationOrigin, SemanticGraphProjectionItem,
};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::ops::ControlFlow;

const MAX_RENDER_NODES: usize = 1_000_000;
const MAX_RENDER_RELATIONS: usize = 10_000_000;
const NEIGHBORHOOD_LIMIT: u32 = 128;

pub(super) fn read_source(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    cut: InspectionCut,
    filters: &MemoryListFilters,
) -> Result<(GraphRenderSource, GraphInspection), HttpError> {
    let mut nodes = Vec::new();
    let mut titles = Vec::new();
    let mut communities = BTreeMap::new();
    let mut render_ids = HashMap::new();
    let mut relation_sources = Vec::new();
    let mut indexed_edges = Vec::new();
    let mut error = None;
    instance
        .visit_semantic_graph_projection(owner, kind, cut, filters, |item| {
            match item {
                SemanticGraphProjectionItem::Community(community) => {
                    if communities.len() == MAX_RENDER_NODES {
                        error = Some(HttpError::new(413, "graph_community_limit", false));
                        return ControlFlow::Break(());
                    }
                    communities.insert(
                        community.id.0,
                        GraphRenderCommunitySource::new(community.id.0, Vec::new())
                            .with_name(community.name),
                    );
                }
                SemanticGraphProjectionItem::Memory {
                    id,
                    title,
                    community_id,
                } => {
                    if nodes.len() == MAX_RENDER_NODES {
                        error = Some(HttpError::new(413, "graph_node_limit", false));
                        return ControlFlow::Break(());
                    }
                    let key = GraphRenderNodeKey::new(id.0.to_vec());
                    let render_id = nodes.len() as u32;
                    if nodes
                        .last()
                        .is_some_and(|node: &GraphRenderNodeSource| node.key >= key)
                    {
                        error = Some(HttpError::new(503, "graph_source_order", false));
                        return ControlFlow::Break(());
                    }
                    render_ids.insert(id.0, render_id);
                    if let Some(community_id) = community_id {
                        let Some(community) = communities.get_mut(&community_id) else {
                            error = Some(HttpError::new(503, "graph_source_invalid", false));
                            return ControlFlow::Break(());
                        };
                        community.members.push(key.clone());
                    }
                    let title = title.filter(|title| !title.trim().is_empty());
                    nodes.push(GraphRenderNodeSource::new(
                        key,
                        title
                            .clone()
                            .unwrap_or_else(|| "Untitled Memory".to_owned()),
                        GraphRenderNodeTarget::new("memory", id.0.to_vec()),
                    ));
                    titles.push(title);
                }
                SemanticGraphProjectionItem::Relation(relation) => {
                    if matches!(
                        relation.kind,
                        RelationKind::EntityAssociation | RelationKind::PrincipalAssociation
                    ) {
                        return ControlFlow::Continue(());
                    }
                    if relation_sources.len() == MAX_RENDER_RELATIONS {
                        error = Some(HttpError::new(413, "graph_relation_limit", false));
                        return ControlFlow::Break(());
                    }
                    let (NodeRef::Memory(source), NodeRef::Memory(target)) =
                        (relation.source, relation.target)
                    else {
                        error = Some(HttpError::new(503, "graph_source_invalid", false));
                        return ControlFlow::Break(());
                    };
                    let (Some(&source_id), Some(&target_id)) =
                        (render_ids.get(&source), render_ids.get(&target))
                    else {
                        error = Some(HttpError::new(503, "graph_source_invalid", false));
                        return ControlFlow::Break(());
                    };
                    relation_sources.push(GraphRenderRelationSource {
                        source: GraphRenderNodeKey::new(source.to_vec()),
                        target: GraphRenderNodeKey::new(target.to_vec()),
                        style: style_for_relation(relation.kind, relation.origin),
                    });
                    indexed_edges.push(IndexedEdge {
                        source_id,
                        target_id,
                        kind: relation.kind,
                        origin: relation.origin,
                    });
                }
            }
            ControlFlow::Continue(())
        })
        .map_err(super::product_error)?;
    if let Some(error) = error {
        return Err(error);
    }
    drop(render_ids);
    let inspection = GraphInspection {
        incident: IncidentIndex::build(titles.len(), indexed_edges),
        titles,
    };
    let source = GraphRenderSource::new(
        owner.to_string(),
        cut.community,
        nodes,
        relation_sources,
        communities
            .into_values()
            .filter(|community| !community.members.is_empty())
            .collect(),
    );
    Ok((source, inspection))
}

#[derive(Clone, Copy)]
struct IndexedEdge {
    source_id: u32,
    target_id: u32,
    kind: RelationKind,
    origin: RelationOrigin,
}

impl IndexedEdge {
    fn endpoints(self) -> impl Iterator<Item = usize> {
        [
            Some(self.source_id),
            (self.source_id != self.target_id).then_some(self.target_id),
        ]
        .into_iter()
        .flatten()
        .map(|id| id as usize)
    }
}

#[derive(Default)]
pub(super) struct GraphInspection {
    pub(super) titles: Vec<Option<String>>,
    pub(super) incident: IncidentIndex,
}

#[derive(Default)]
pub(super) struct IncidentIndex {
    edges: Vec<IndexedEdge>,
    counts: Vec<u32>,
    offsets: Vec<u32>,
    incident: Vec<u32>,
}

impl IncidentIndex {
    fn build(node_count: usize, edges: Vec<IndexedEdge>) -> Self {
        let mut counts = vec![0_u32; node_count];
        for edge in &edges {
            for node in edge.endpoints() {
                counts[node] += 1;
            }
        }
        let mut offsets = Vec::with_capacity(node_count + 1);
        offsets.push(0);
        for count in &counts {
            offsets.push(offsets.last().unwrap() + count.min(&NEIGHBORHOOD_LIMIT));
        }
        let mut next = offsets[..node_count].to_vec();
        let mut incident = vec![0; offsets[node_count] as usize];
        for (index, edge) in edges.iter().enumerate() {
            for node in edge.endpoints() {
                if next[node] < offsets[node + 1] {
                    incident[next[node] as usize] = index as u32;
                    next[node] += 1;
                }
            }
        }
        Self {
            edges,
            counts,
            offsets,
            incident,
        }
    }

    pub(super) fn neighborhood(
        &self,
        id: u32,
        positions: &[GraphRenderVec3],
    ) -> Option<Neighborhood> {
        let node = id as usize;
        let total_count = *self.counts.get(node)?;
        let edges = self.incident[self.offsets[node] as usize..self.offsets[node + 1] as usize]
            .iter()
            .map(|index| {
                let edge = self.edges[*index as usize];
                let style = style_for_relation(edge.kind, edge.origin);
                NeighborhoodEdge {
                    source_render_id: edge.source_id,
                    target_render_id: edge.target_id,
                    source_position: positions[edge.source_id as usize],
                    target_position: positions[edge.target_id as usize],
                    style: NeighborhoodStyle {
                        packed_color: style.packed_color,
                        relation_kind: format!("{:?}", edge.kind),
                    },
                    directed: true,
                    weight: edge_weight_from_units(u64::from(style.weight_units)),
                }
            })
            .collect();
        Some(Neighborhood {
            edges,
            total_count,
            truncated: total_count > NEIGHBORHOOD_LIMIT,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Neighborhood {
    edges: Vec<NeighborhoodEdge>,
    total_count: u32,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NeighborhoodEdge {
    source_render_id: u32,
    target_render_id: u32,
    source_position: GraphRenderVec3,
    target_position: GraphRenderVec3,
    style: NeighborhoodStyle,
    directed: bool,
    weight: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NeighborhoodStyle {
    packed_color: u32,
    relation_kind: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dense_selection_reports_exact_total_and_keeps_both_directions() {
        let edges = (1..=140)
            .map(|node| IndexedEdge {
                source_id: if node % 2 == 0 { node } else { 0 },
                target_id: if node % 2 == 0 { 0 } else { node },
                kind: RelationKind::References,
                origin: RelationOrigin::User,
            })
            .collect();
        let index = IncidentIndex::build(141, edges);
        let positions = vec![[1.0, 2.0, 3.0]; 141];
        let selected = index.neighborhood(0, &positions).unwrap();
        assert_eq!(selected.total_count, 140);
        assert_eq!(selected.edges.len(), NEIGHBORHOOD_LIMIT as usize);
        assert!(selected.truncated);
        assert_eq!(selected.edges[0].source_render_id, 0);
        assert_eq!(selected.edges[1].target_render_id, 0);
        assert_eq!(selected.edges[1].source_position, positions[2]);
        assert_eq!(index.neighborhood(140, &positions).unwrap().total_count, 1);
        assert!(index.neighborhood(141, &positions).is_none());
    }
}
