//! Standalone HP03 loopback service. Standard input carries the startup secret.
mod dashboard;
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
    let validate = first.as_deref() == Some(OsStr::new("setup-validate"));
    let state_dir_option = if validate { arguments.next() } else { first };
    if state_dir_option.as_deref() != Some(OsStr::new("--state-dir")) {
        return Err("invalid_arguments");
    }
    let path = PathBuf::from(arguments.next().ok_or("invalid_arguments")?);
    if arguments.next().is_some() {
        return Err("invalid_arguments");
    }
    if validate {
        registry::setup_validation::run(&path)
    } else {
        service::run(&path)
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
