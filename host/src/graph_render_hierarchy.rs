use crate::graph_render_contract::GraphRenderHierarchyKind;
use crate::graph_render_error::GraphRenderError;
use crate::graph_render_hierarchy_model::{
    GraphRenderHierarchy, GraphRenderHierarchyNode, GraphRenderLeaf,
};
use crate::graph_render_identity::GraphRenderNodeKey;
use crate::graph_render_identity::RenderNodeId;
use crate::graph_render_source::{GraphRenderCommunitySource, reject_duplicate_community_ids};
use std::collections::BTreeMap;

pub(crate) const DEFAULT_GRAPH_RENDER_LEAF_CAPACITY: u32 = 32_768;
pub(crate) const GRAPH_RENDER_SUBGROUP_LEAF_FANOUT: u32 = 32;

pub(crate) fn build_graph_render_hierarchy(
    node_keys: &[GraphRenderNodeKey],
    mut communities: Vec<GraphRenderCommunitySource>,
    leaf_capacity: u32,
    subgroup_leaf_fanout: u32,
) -> Result<GraphRenderHierarchy, GraphRenderError> {
    debug_assert!(leaf_capacity > 0);
    debug_assert!(subgroup_leaf_fanout > 0);
    communities.sort_unstable_by(|left, right| left.community_id.cmp(&right.community_id));
    reject_duplicate_community_ids(&communities)?;
    let community_ids = communities
        .iter()
        .map(|community| community.community_id)
        .collect::<Vec<_>>();
    let mut claimed = vec![u32::MAX; node_keys.len()];
    let mut territories = Vec::with_capacity(communities.len() + 1);
    let mut community_names = BTreeMap::new();

    for (community_index, mut community) in communities.into_iter().enumerate() {
        community.members.sort_unstable();
        if let Some(duplicate) = community
            .members
            .windows(2)
            .find(|pair| pair[0] == pair[1])
            .map(|pair| pair[0].clone())
        {
            return Err(GraphRenderError::DuplicateCommunityMember {
                community_id: community.community_id,
                node_key: duplicate,
            });
        }

        let community_index =
            u32::try_from(community_index).map_err(|_| GraphRenderError::HierarchyIdOverflow)?;
        let mut territory = Vec::with_capacity(community.members.len());
        for node_key in community.members {
            let index = node_keys.binary_search(&node_key).map_err(|_| {
                GraphRenderError::CommunityNodeUnavailable {
                    community_id: community.community_id,
                    node_key: node_key.clone(),
                }
            })?;
            let first_index = claimed[index];
            if first_index != u32::MAX {
                return Err(GraphRenderError::NodeInMultipleCommunities {
                    node_key: node_key.clone(),
                    first_community_id: community_ids[first_index as usize],
                    second_community_id: community.community_id,
                });
            }
            claimed[index] = community_index;
            territory.push(RenderNodeId::new(index as u32));
        }
        if !territory.is_empty() {
            if let Some(name) = community.name.filter(|name| !name.trim().is_empty()) {
                community_names.insert(community.community_id, name);
            }
            territories.push((Some(community.community_id), territory));
        }
    }
    let unassigned = claimed
        .iter()
        .enumerate()
        .filter(|(_, community_index)| **community_index == u32::MAX)
        .map(|(index, _)| RenderNodeId::new(index as u32))
        .collect::<Vec<_>>();
    if !unassigned.is_empty() {
        territories.push((None, unassigned));
    }

    build_tree(
        node_keys.len() as u32,
        territories,
        leaf_capacity as usize,
        subgroup_leaf_fanout as usize,
        community_names,
    )
}

fn build_tree(
    total_nodes: u32,
    territories: Vec<(Option<[u8; 32]>, Vec<RenderNodeId>)>,
    leaf_capacity: usize,
    subgroup_leaf_fanout: usize,
    community_names: BTreeMap<[u8; 32], String>,
) -> Result<GraphRenderHierarchy, GraphRenderError> {
    let mut hierarchy = GraphRenderHierarchy {
        nodes: vec![GraphRenderHierarchyNode {
            id: 0,
            parent_id: None,
            kind: GraphRenderHierarchyKind::Graph,
            node_count: total_nodes,
            source_community_id: None,
        }],
        leaves: Vec::new(),
        community_names,
    };

    for (community_id, render_ids) in territories {
        let territory_id = push_node(
            &mut hierarchy.nodes,
            0,
            GraphRenderHierarchyKind::Territory,
            render_ids.len(),
            community_id,
        )?;
        let leaf_slices = render_ids.chunks(leaf_capacity).collect::<Vec<_>>();

        if leaf_slices.len() <= 1 {
            push_leaf(&mut hierarchy, territory_id, leaf_slices[0])?;
            continue;
        }

        for leaf_group in leaf_slices.chunks(subgroup_leaf_fanout) {
            let subgroup_count = leaf_group.iter().map(|leaf| leaf.len()).sum();
            let subgroup_id = push_node(
                &mut hierarchy.nodes,
                territory_id,
                GraphRenderHierarchyKind::Subgroup,
                subgroup_count,
                None,
            )?;
            for leaf in leaf_group {
                push_leaf(&mut hierarchy, subgroup_id, leaf)?;
            }
        }
    }

    Ok(hierarchy)
}

fn push_leaf(
    hierarchy: &mut GraphRenderHierarchy,
    parent_id: u32,
    render_ids: &[RenderNodeId],
) -> Result<(), GraphRenderError> {
    let hierarchy_id = push_node(
        &mut hierarchy.nodes,
        parent_id,
        GraphRenderHierarchyKind::Leaf,
        render_ids.len(),
        None,
    )?;
    let chunk_id =
        u32::try_from(hierarchy.leaves.len()).map_err(|_| GraphRenderError::HierarchyIdOverflow)?;
    hierarchy.leaves.push(GraphRenderLeaf {
        hierarchy_id,
        chunk_id,
        render_ids: render_ids.to_vec(),
    });
    Ok(())
}

fn push_node(
    nodes: &mut Vec<GraphRenderHierarchyNode>,
    parent_id: u32,
    kind: GraphRenderHierarchyKind,
    node_count: usize,
    source_community_id: Option<[u8; 32]>,
) -> Result<u32, GraphRenderError> {
    let id = u32::try_from(nodes.len()).map_err(|_| GraphRenderError::HierarchyIdOverflow)?;
    nodes.push(GraphRenderHierarchyNode {
        id,
        parent_id: Some(parent_id),
        kind,
        node_count: node_count as u32,
        source_community_id,
    });
    Ok(id)
}
