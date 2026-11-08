//! Standalone HP03 loopback service. Standard input carries the startup secret.
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

fn state_dir() -> Result<PathBuf, &'static str> {
    let mut arguments = env::args_os().skip(1);
    if arguments.next().as_deref() != Some(OsStr::new("--state-dir")) {
        return Err("invalid_arguments");
    }
    let path = arguments.next().ok_or("invalid_arguments")?;
    if arguments.next().is_some() {
        return Err("invalid_arguments");
    }
    Ok(path.into())
}

fn main() -> ExitCode {
    // The host may see trusted local config and request data inside errors.
    // Only fixed diagnostics belong on its process output.
    std::panic::set_hook(Box::new(|_| {
        eprintln!("reliquary-hermes-host: internal_error")
    }));
    match state_dir().and_then(|path| service::run(&path)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(code) => {
            eprintln!("reliquary-hermes-host: {code}");
            ExitCode::FAILURE
        }
    }
}
