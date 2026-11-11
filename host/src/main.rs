//! Standalone HP03 loopback service. Standard input carries the startup secret.
mod dashboard;
mod catalog_processing;
mod graph_render;
mod graph_render_binary;
#[cfg(test)]
mod graph_render_binary_layout_tests;
#[cfg(test)]
mod graph_render_binary_tests;
mod graph_render_chunk_store;
mod graph_render_contract;
#[cfg(test)]
mod graph_render_contract_tests;
mod graph_render_edge_chunk;
mod graph_render_edge_materialization;
#[cfg(test)]
mod graph_render_edge_materialization_tests;
mod graph_render_edge_payload;
mod graph_render_edge_projection;
mod graph_render_edge_projection_model;
mod graph_render_edge_projection_support;
#[cfg(test)]
mod graph_render_edge_projection_tests;
mod graph_render_edge_reuse;
mod graph_render_error;
mod graph_render_generation;
#[cfg(test)]
mod graph_render_generic_identity_tests;
mod graph_render_hierarchy;
mod graph_render_hierarchy_model;
#[cfg(test)]
mod graph_render_hierarchy_tests;
mod graph_render_host;
mod graph_render_identity;
mod graph_render_layout;
mod graph_render_layout_model;
#[cfg(test)]
mod graph_render_layout_tests;
mod graph_render_manifest;
#[cfg(test)]
mod graph_render_manifest_tests;
mod graph_render_node_chunk;
mod graph_render_node_materialization;
#[cfg(test)]
mod graph_render_node_materialization_tests;
mod graph_render_prepare;
#[cfg(test)]
mod graph_render_reuse_tests;
#[cfg(test)]
mod graph_render_scale_tests;
mod graph_render_source;
mod graph_render_source_style;
mod graph_render_style;
#[cfg(test)]
mod graph_render_style_tests;
#[cfg(test)]
mod graph_render_tests;
mod registry;
mod retrieval;
mod runtime;
mod service;
mod service_http;
mod service_protocol;
mod source_ingest;
mod source_store;
mod source_wire;

use std::{env, ffi::OsStr, path::PathBuf, process::ExitCode};

fn run() -> Result<(), &'static str> {
    let mut arguments = env::args_os().skip(1);
    let first = arguments.next();
    let (setup, state_dir_option) = match first.as_deref().and_then(OsStr::to_str) {
        Some(mode @ ("setup-validate" | "setup-create")) => (Some(mode), arguments.next()),
        _ => (None, first.clone()),
    };
    if state_dir_option.as_deref() != Some(OsStr::new("--state-dir")) {
        return Err("invalid_arguments");
    }
    let path = PathBuf::from(arguments.next().ok_or("invalid_arguments")?);
    if arguments.next().is_some() {
        return Err("invalid_arguments");
    }
    match setup {
        Some("setup-validate") => registry::setup_validation::run(&path),
        Some("setup-create") => registry::setup_validation::run_create(&path),
        _ => service::run(&path),
    }
}

fn main() -> ExitCode {
    // The host may see trusted local config and request data inside errors.
    // Only fixed diagnostics belong on its process output.
    std::panic::set_hook(Box::new(|_| {
        eprintln!("reliquary-hermes-host: internal_error")
    }));
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(code) => {
            eprintln!("reliquary-hermes-host: {code}");
            ExitCode::FAILURE
        }
    }
}
