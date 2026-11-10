//! Standalone Hermes host integration through Reliquary's public Root API.

mod retrieval_hack;

mod graph_render;
mod graph_render_binary;
mod graph_render_chunk_store;
mod graph_render_contract;
mod graph_render_edge_chunk;
mod graph_render_edge_materialization;
mod graph_render_edge_payload;
mod graph_render_edge_projection;
mod graph_render_edge_projection_model;
mod graph_render_edge_projection_support;
mod graph_render_edge_reuse;
mod graph_render_error;
mod graph_render_generation;
mod graph_render_hierarchy;
mod graph_render_hierarchy_model;
mod graph_render_host;
mod graph_render_identity;
mod graph_render_layout;
mod graph_render_layout_grid;
mod graph_render_layout_model;
mod graph_render_manifest;
mod graph_render_node_chunk;
mod graph_render_node_materialization;
mod graph_render_prepare;
mod graph_render_source;
mod graph_render_style;

#[cfg(test)]
mod graph_render_binary_layout_tests;
#[cfg(test)]
mod graph_render_binary_tests;
#[cfg(test)]
mod graph_render_contract_tests;
#[cfg(test)]
mod graph_render_edge_materialization_tests;
#[cfg(test)]
mod graph_render_edge_projection_tests;
#[cfg(test)]
mod graph_render_generic_identity_tests;
#[cfg(test)]
mod graph_render_hierarchy_tests;
#[cfg(test)]
mod graph_render_layout_tests;
#[cfg(test)]
mod graph_render_manifest_tests;
#[cfg(test)]
mod graph_render_node_materialization_tests;
#[cfg(test)]
mod graph_render_reuse_tests;
#[cfg(test)]
mod graph_render_scale_tests;
mod graph_render_source_style;
#[cfg(test)]
mod graph_render_style_tests;
#[cfg(test)]
mod graph_render_tests;

pub use retrieval_hack::{ReturnOutcome, SelectedReturn};
