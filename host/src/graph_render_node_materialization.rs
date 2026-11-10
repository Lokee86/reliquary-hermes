use crate::graph_render_binary::rebind_payload_header;
use crate::graph_render_chunk_store::{GraphRenderChunkStore, GraphRenderNodePayload};
use crate::graph_render_contract::{
    GraphRenderLabelCandidateDescriptor, GraphRenderNodeChunkDescriptor,
};
use crate::graph_render_error::GraphRenderError;
use crate::graph_render_hierarchy_model::{GraphRenderHierarchy, GraphRenderLeaf};
use crate::graph_render_layout_model::GraphRenderLayout;
use crate::graph_render_node_chunk::GraphRenderNodeChunk;
use crate::graph_render_source::GraphRenderNodeSource;
use crate::graph_render_style::{node_color_from_degree, node_size_from_degree};

pub(crate) const GRAPH_RENDER_LABEL_CANDIDATES_PER_CHUNK: usize = 4;
pub(crate) const GRAPH_RENDER_LABEL_MAX_CHARS: usize = 64;

pub(crate) struct GraphRenderNodeReuse<'a> {
    pub(crate) previous_degrees: &'a [u32],
    pub(crate) previous_store: &'a GraphRenderChunkStore,
}

pub(crate) fn build_node_chunk_store(
    generation_id: u64,
    hierarchy: &GraphRenderHierarchy,
    layout: &GraphRenderLayout,
    degrees: &[u32],
    nodes: &[GraphRenderNodeSource],
    reuse: Option<GraphRenderNodeReuse<'_>>,
) -> Result<(GraphRenderChunkStore, u32, u32), GraphRenderError> {
    let mut node_payloads = Vec::with_capacity(hierarchy.leaves.len());
    let mut reused = 0_u32;
    let mut encoded = 0_u32;

    for leaf in &hierarchy.leaves {
        let label_candidates = select_label_candidates(&leaf.render_ids, degrees, nodes);
        if let Some(payload) = reusable_payload(
            generation_id,
            leaf,
            layout,
            degrees,
            &label_candidates,
            reuse.as_ref(),
        ) {
            node_payloads.push(payload);
            reused += 1;
            continue;
        }

        node_payloads.push(encode_leaf(
            generation_id,
            leaf,
            layout,
            degrees,
            label_candidates,
        )?);
        encoded += 1;
    }

    Ok((
        GraphRenderChunkStore {
            node_payloads,
            edge_payloads: vec![],
        },
        reused,
        encoded,
    ))
}

fn reusable_payload(
    generation_id: u64,
    leaf: &GraphRenderLeaf,
    layout: &GraphRenderLayout,
    degrees: &[u32],
    label_candidates: &[GraphRenderLabelCandidateDescriptor],
    reuse: Option<&GraphRenderNodeReuse<'_>>,
) -> Option<GraphRenderNodePayload> {
    let reuse = reuse?;
    if leaf.render_ids.iter().any(|render_id| {
        let index = render_id.get() as usize;
        reuse.previous_degrees.get(index) != degrees.get(index)
    }) {
        return None;
    }

    let previous = reuse.previous_store.node_payload(leaf.chunk_id)?;
    let layout_node = layout.hierarchy[leaf.hierarchy_id as usize];
    if previous.descriptor.parent_hierarchy_id != leaf.hierarchy_id
        || previous.descriptor.bounds != layout_node.bounds
        || previous.descriptor.node_count != leaf.render_ids.len() as u32
        || previous.descriptor.label_candidates != label_candidates
    {
        return None;
    }

    Some(GraphRenderNodePayload {
        descriptor: previous.descriptor.clone(),
        bytes: rebind_payload_header(&previous.bytes, generation_id, leaf.chunk_id),
    })
}

fn encode_leaf(
    generation_id: u64,
    leaf: &GraphRenderLeaf,
    layout: &GraphRenderLayout,
    degrees: &[u32],
    label_candidates: Vec<GraphRenderLabelCandidateDescriptor>,
) -> Result<GraphRenderNodePayload, GraphRenderError> {
    let mut positions = Vec::with_capacity(leaf.render_ids.len());
    let mut packed_colors = Vec::with_capacity(leaf.render_ids.len());
    let mut sizes = Vec::with_capacity(leaf.render_ids.len());

    for render_id in &leaf.render_ids {
        let index = render_id.get() as usize;
        positions.push(layout.positions[index]);
        packed_colors.push(node_color_from_degree(degrees[index]));
        sizes.push(node_size_from_degree(degrees[index]));
    }

    let chunk = GraphRenderNodeChunk {
        generation_id,
        chunk_id: leaf.chunk_id,
        positions,
        packed_colors,
        sizes,
        render_ids: leaf.render_ids.clone(),
    };
    let bytes = chunk
        .encode()
        .map_err(|error| GraphRenderError::NodeChunkEncoding(error.to_string()))?;
    let byte_len = u32::try_from(bytes.len())
        .map_err(|_| GraphRenderError::NodeChunkEncoding("payload exceeds u32 length".into()))?;
    let layout_node = layout.hierarchy[leaf.hierarchy_id as usize];

    Ok(GraphRenderNodePayload {
        descriptor: GraphRenderNodeChunkDescriptor {
            chunk_id: leaf.chunk_id,
            parent_hierarchy_id: leaf.hierarchy_id,
            bounds: layout_node.bounds,
            node_count: leaf.render_ids.len() as u32,
            byte_len,
            label_candidates,
        },
        bytes,
    })
}

fn select_label_candidates(
    render_ids: &[crate::graph_render_identity::RenderNodeId],
    degrees: &[u32],
    nodes: &[GraphRenderNodeSource],
) -> Vec<GraphRenderLabelCandidateDescriptor> {
    let mut selected: Vec<(u32, u32, u32)> =
        Vec::with_capacity(GRAPH_RENDER_LABEL_CANDIDATES_PER_CHUNK);

    for (item_index, render_id) in render_ids.iter().enumerate() {
        let global_index = render_id.get() as usize;
        let candidate = (degrees[global_index], render_id.get(), item_index as u32);
        let insert_at = selected
            .iter()
            .position(|current| {
                candidate.0 > current.0 || (candidate.0 == current.0 && candidate.1 < current.1)
            })
            .unwrap_or(selected.len());
        if insert_at < GRAPH_RENDER_LABEL_CANDIDATES_PER_CHUNK {
            selected.insert(insert_at, candidate);
            selected.truncate(GRAPH_RENDER_LABEL_CANDIDATES_PER_CHUNK);
        }
    }

    selected
        .into_iter()
        .map(
            |(importance, render_id, item_index)| GraphRenderLabelCandidateDescriptor {
                render_id,
                item_index,
                importance,
                label: bounded_label(&nodes[render_id as usize].label, render_id),
            },
        )
        .collect()
}

fn bounded_label(label: &str, render_id: u32) -> String {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        return format!("Node {render_id}");
    }

    let mut chars = trimmed.chars();
    let prefix = chars
        .by_ref()
        .take(GRAPH_RENDER_LABEL_MAX_CHARS.saturating_sub(3))
        .collect::<String>();
    if chars.next().is_some() {
        format!("{prefix}...")
    } else {
        prefix
    }
}
