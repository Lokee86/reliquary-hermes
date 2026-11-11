use crate::graph_render_contract::GraphRenderManifest;
use crate::graph_render_error::GraphRenderError;
use crate::graph_render_generation::{GraphRenderGeneration, GraphRenderGenerationSummary};
use crate::graph_render_hierarchy_model::GraphRenderHierarchy;
use crate::graph_render_identity::RenderNodeId;
use crate::graph_render_identity::{GraphRenderNodeKey, GraphRenderNodeTarget};
use crate::graph_render_layout_model::GraphRenderLayout;
use crate::graph_render_prepare::build_graph_render_generation;
use crate::graph_render_source::GraphRenderSource;
use std::collections::BTreeMap;

pub(crate) struct GraphRenderService {
    next_generation_id: u64,
    latest_by_owner: BTreeMap<String, u64>,
    generations: BTreeMap<u64, GraphRenderGeneration>,
}

impl Default for GraphRenderService {
    fn default() -> Self {
        Self {
            next_generation_id: 1,
            latest_by_owner: BTreeMap::new(),
            generations: BTreeMap::new(),
        }
    }
}

impl GraphRenderService {
    pub(crate) fn locate_node(
        &self,
        generation_id: u64,
        key: &GraphRenderNodeKey,
    ) -> Result<Option<RenderNodeId>, GraphRenderError> {
        Ok(self
            .generation(generation_id)?
            .node_keys
            .binary_search(key)
            .ok()
            .map(|index| RenderNodeId::new(index as u32)))
    }

    pub(crate) fn clear(&mut self) {
        self.latest_by_owner.clear();
        self.generations.clear();
    }

    pub(crate) fn prepare(
        &mut self,
        source: GraphRenderSource,
    ) -> Result<GraphRenderGenerationSummary, GraphRenderError> {
        if self.next_generation_id == u64::MAX {
            return Err(GraphRenderError::GenerationIdExhausted);
        }

        let generation_id = self.next_generation_id;
        let previous = self
            .latest_by_owner
            .get(&source.owner_id)
            .and_then(|generation_id| self.generations.get(generation_id));
        let generation = build_graph_render_generation(generation_id, source, previous)?;
        let summary = generation.summary.clone();
        self.next_generation_id += 1;

        if let Some(previous) = self
            .latest_by_owner
            .insert(summary.owner_id.clone(), generation_id)
        {
            self.generations.remove(&previous);
        }
        self.generations.insert(generation_id, generation);

        Ok(summary)
    }

    pub(crate) fn resolve_node(
        &self,
        generation_id: u64,
        render_id: RenderNodeId,
    ) -> Result<GraphRenderNodeTarget, GraphRenderError> {
        self.generation(generation_id)?
            .node_targets
            .get(render_id.get() as usize)
            .cloned()
            .ok_or(GraphRenderError::RenderNodeUnavailable {
                generation_id,
                render_id,
            })
    }

    pub(crate) fn hierarchy(
        &self,
        generation_id: u64,
    ) -> Result<&GraphRenderHierarchy, GraphRenderError> {
        Ok(&self.generation(generation_id)?.hierarchy)
    }

    pub(crate) fn layout(
        &self,
        generation_id: u64,
    ) -> Result<&GraphRenderLayout, GraphRenderError> {
        Ok(&self.generation(generation_id)?.layout)
    }

    pub(crate) fn manifest(
        &self,
        generation_id: u64,
    ) -> Result<&GraphRenderManifest, GraphRenderError> {
        Ok(&self.generation(generation_id)?.manifest)
    }

    pub(crate) fn node_chunk(
        &self,
        generation_id: u64,
        chunk_id: u32,
    ) -> Result<&[u8], GraphRenderError> {
        self.generation(generation_id)?
            .chunks
            .node_payload(chunk_id)
            .map(|payload| payload.bytes.as_slice())
            .ok_or(GraphRenderError::NodeChunkUnavailable {
                generation_id,
                chunk_id,
            })
    }

    pub(crate) fn edge_chunk(
        &self,
        generation_id: u64,
        chunk_id: u32,
    ) -> Result<&[u8], GraphRenderError> {
        self.generation(generation_id)?
            .chunks
            .edge_payload(chunk_id)
            .map(|payload| payload.bytes.as_slice())
            .ok_or(GraphRenderError::EdgeChunkUnavailable {
                generation_id,
                chunk_id,
            })
    }

    fn generation(&self, generation_id: u64) -> Result<&GraphRenderGeneration, GraphRenderError> {
        self.generations
            .get(&generation_id)
            .ok_or(GraphRenderError::GenerationUnavailable(generation_id))
    }

    pub(crate) fn latest_generation(
        &self,
        owner_id: &str,
    ) -> Option<&GraphRenderGenerationSummary> {
        self.latest_by_owner
            .get(owner_id)
            .and_then(|generation_id| self.generations.get(generation_id))
            .map(|generation| &generation.summary)
    }

    pub(crate) fn resident_bytes(&self, generation_id: u64) -> Result<usize, GraphRenderError> {
        let generation = self.generation(generation_id)?;
        Ok(generation
            .chunks
            .node_payloads
            .iter()
            .map(|payload| payload.bytes.len())
            .chain(
                generation
                    .chunks
                    .edge_payloads
                    .iter()
                    .map(|payload| payload.bytes.len()),
            )
            .fold(0usize, usize::saturating_add))
    }
}
