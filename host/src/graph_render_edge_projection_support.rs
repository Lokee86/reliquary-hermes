use crate::graph_render_contract::GraphRenderHierarchyKind;
use crate::graph_render_edge_projection_model::{GraphRenderDetailEdge, GraphRenderEdgeAggregate};
use crate::graph_render_error::GraphRenderError;
use crate::graph_render_hierarchy_model::GraphRenderHierarchy;
use crate::graph_render_identity::GraphRenderNodeKey;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BinaryHeap};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct DetailCandidate {
    pub(crate) priority: u64,
    pub(crate) edge: GraphRenderDetailEdge,
}

impl Ord for DetailCandidate {
    fn cmp(&self, other: &Self) -> Ordering {
        self.priority
            .cmp(&other.priority)
            .then_with(|| self.edge.cmp(&other.edge))
    }
}

impl PartialOrd for DetailCandidate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub(crate) fn add_aggregate(
    map: &mut BTreeMap<(u32, u32), GraphRenderEdgeAggregate>,
    source: u32,
    target: u32,
    color: u32,
    weight: u32,
) {
    if source == target || source == u32::MAX || target == u32::MAX {
        return;
    }
    let pair = if source < target {
        (source, target)
    } else {
        (target, source)
    };
    map.entry(pair).or_default().add(color, weight);
}

pub(crate) fn retain_detail(
    heap: &mut BinaryHeap<DetailCandidate>,
    candidate: DetailCandidate,
    limit: usize,
) {
    if heap.len() < limit {
        heap.push(candidate);
    } else if heap.peek().is_some_and(|largest| candidate < *largest) {
        heap.pop();
        heap.push(candidate);
    }
}

pub(crate) fn territory_for_leaf(hierarchy: &GraphRenderHierarchy, leaf_id: u32) -> u32 {
    let mut current = leaf_id;
    loop {
        let node = &hierarchy.nodes[current as usize];
        if node.kind == GraphRenderHierarchyKind::Territory {
            return current;
        }
        current = node.parent_id.expect("leaf hierarchy reaches territory");
    }
}

pub(crate) fn node_index(
    node_keys: &[GraphRenderNodeKey],
    node_key: &GraphRenderNodeKey,
) -> Result<usize, GraphRenderError> {
    node_keys
        .binary_search(node_key)
        .map_err(|_| GraphRenderError::RelationNodeUnavailable(node_key.clone()))
}

pub(crate) fn detail_priority(edge: GraphRenderDetailEdge) -> u64 {
    let mut value = ((edge.source.get() as u64) << 32) | edge.target.get() as u64;
    value ^= edge.style.detail_priority_tag;
    splitmix64(value)
}

fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}
