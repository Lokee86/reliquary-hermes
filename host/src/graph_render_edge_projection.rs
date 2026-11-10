use crate::graph_render_edge_projection_model::{
    GraphRenderDetailEdge, GraphRenderEdgeAggregate, GraphRenderEdgeProjection,
};
use crate::graph_render_edge_projection_support::{
    DetailCandidate, add_aggregate, detail_priority, node_index, retain_detail, territory_for_leaf,
};
use crate::graph_render_error::GraphRenderError;
use crate::graph_render_hierarchy_model::GraphRenderHierarchy;
use crate::graph_render_identity::GraphRenderNodeKey;
use crate::graph_render_source::GraphRenderRelationSource;
use std::collections::{BTreeMap, BinaryHeap};

pub(crate) const GRAPH_RENDER_DETAIL_EDGE_LIMIT: usize = 8_192;

pub(crate) struct GraphRenderEdgeProjectionBuilder {
    degrees: Vec<u32>,
    territory_by_render: Vec<u32>,
    leaf_by_render: Vec<u32>,
    leaf_slot_by_render: Vec<u32>,
    overview: BTreeMap<(u32, u32), GraphRenderEdgeAggregate>,
    intermediate: BTreeMap<(u32, u32), GraphRenderEdgeAggregate>,
    detail: Vec<BinaryHeap<DetailCandidate>>,
    detail_limit: usize,
}

impl GraphRenderEdgeProjectionBuilder {
    pub(crate) fn new(
        node_count: usize,
        hierarchy: &GraphRenderHierarchy,
        detail_limit: usize,
    ) -> Self {
        let mut territory_by_render = vec![u32::MAX; node_count];
        let mut leaf_by_render = vec![u32::MAX; node_count];
        let mut leaf_slot_by_render = vec![u32::MAX; node_count];

        for (leaf_slot, leaf) in hierarchy.leaves.iter().enumerate() {
            let territory = territory_for_leaf(hierarchy, leaf.hierarchy_id);
            for render_id in &leaf.render_ids {
                let index = render_id.get() as usize;
                territory_by_render[index] = territory;
                leaf_by_render[index] = leaf.hierarchy_id;
                leaf_slot_by_render[index] = leaf_slot as u32;
            }
        }

        Self {
            degrees: vec![0; node_count],
            territory_by_render,
            leaf_by_render,
            leaf_slot_by_render,
            overview: BTreeMap::new(),
            intermediate: BTreeMap::new(),
            detail: (0..hierarchy.leaves.len())
                .map(|_| BinaryHeap::new())
                .collect(),
            detail_limit,
        }
    }

    pub(crate) fn push(
        &mut self,
        node_keys: &[GraphRenderNodeKey],
        relation: &GraphRenderRelationSource,
    ) -> Result<(), GraphRenderError> {
        let source = node_index(node_keys, &relation.source)?;
        let target = node_index(node_keys, &relation.target)?;
        self.degrees[source] = self.degrees[source].saturating_add(1);
        self.degrees[target] = self.degrees[target].saturating_add(1);

        if source == target {
            return Ok(());
        }

        let color = relation.style.packed_color;
        let weight = relation.style.weight_units;
        add_aggregate(
            &mut self.overview,
            self.territory_by_render[source],
            self.territory_by_render[target],
            color,
            weight,
        );
        add_aggregate(
            &mut self.intermediate,
            self.leaf_by_render[source],
            self.leaf_by_render[target],
            color,
            weight,
        );

        let source_slot = self.leaf_slot_by_render[source];
        let target_slot = self.leaf_slot_by_render[target];
        if source_slot == target_slot && source_slot != u32::MAX && self.detail_limit > 0 {
            let edge = GraphRenderDetailEdge {
                source: crate::graph_render_identity::RenderNodeId::new(source as u32),
                target: crate::graph_render_identity::RenderNodeId::new(target as u32),
                style: relation.style,
            };
            retain_detail(
                &mut self.detail[source_slot as usize],
                DetailCandidate {
                    priority: detail_priority(edge),
                    edge,
                },
                self.detail_limit,
            );
        }
        Ok(())
    }

    pub(crate) fn finish(self) -> GraphRenderEdgeProjection {
        let detail_by_leaf = self
            .detail
            .into_iter()
            .map(|heap| {
                heap.into_sorted_vec()
                    .into_iter()
                    .map(|candidate| candidate.edge)
                    .collect()
            })
            .collect();
        GraphRenderEdgeProjection {
            degrees: self.degrees,
            overview: self.overview,
            intermediate: self.intermediate,
            detail_by_leaf,
        }
    }
}

pub(crate) fn build_edge_projection(
    node_keys: &[GraphRenderNodeKey],
    relations: &[GraphRenderRelationSource],
    hierarchy: &GraphRenderHierarchy,
) -> Result<GraphRenderEdgeProjection, GraphRenderError> {
    let mut builder = GraphRenderEdgeProjectionBuilder::new(
        node_keys.len(),
        hierarchy,
        GRAPH_RENDER_DETAIL_EDGE_LIMIT,
    );
    for relation in relations {
        builder.push(node_keys, relation)?;
    }
    Ok(builder.finish())
}
