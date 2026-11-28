//! The selected embedding route and its nonsecret owner binding.
use crate::{embedding_binding::EmbeddingBinding, service::read_bounded, service_protocol::decode};
use reliquary_memory::{
    ConfiguredRuntimeError, EmbeddingEndpoint, EmbeddingNormalization,
    HostedEmbeddingInputSemantics, HostedInferenceIdentity, ResolvedEmbeddingRoute,
};
use serde::Deserialize;
use serde_json::json;
use std::{
    fs::File,
    io::{self, ErrorKind},
    path::{Path, PathBuf},
    sync::Arc,
};

const POINTER_FILE: &str = "processing.json";
const MAX_POINTER_BYTES: usize = 8192;
const UNCONFIGURED: &str = "embedding_unconfigured";
const INVALID: &str = "embedding_config_invalid";
const CREDENTIALS_UNAVAILABLE: &str = "embedding_credentials_unavailable";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Pointer {
    config_path: PathBuf,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CheckRequest {
    config_path: Option<PathBuf>,
}

pub(crate) struct EmbeddingRoute {
    pub(crate) endpoint: Arc<dyn EmbeddingEndpoint>,
    pub(crate) binding: EmbeddingBinding,
    input_semantics: HostedEmbeddingInputSemantics,
}

impl EmbeddingRoute {
    pub(crate) fn for_profile(state_dir: &Path) -> Result<Self, &'static str> {
        let path = state_dir.join(POINTER_FILE);
        match path.symlink_metadata() {
            Err(error) if error.kind() == ErrorKind::NotFound => return Err(UNCONFIGURED),
            Ok(meta) if meta.is_file() => {}
            _ => return Err(INVALID),
        }
        let file = File::open(path).map_err(|_| INVALID)?;
        let bytes = read_bounded(file, MAX_POINTER_BYTES).map_err(|_| INVALID)?;
        let pointer: Pointer = decode(&bytes).map_err(|_| INVALID)?;
        Self::open(&pointer.config_path)
    }

    fn open(path: &Path) -> Result<Self, &'static str> {
        if !path.is_absolute() || !path.is_file() {
            return Err(INVALID);
        }
        let route = ResolvedEmbeddingRoute::from_path(path)
            .map_err(|error| match error {
                ConfiguredRuntimeError::Credential { .. }
                | ConfiguredRuntimeError::MasterKey(_) => CREDENTIALS_UNAVAILABLE,
                _ => INVALID,
            })?
            .ok_or(UNCONFIGURED)?;
        let endpoint = route.endpoint;
        let model = endpoint.model().ok_or(INVALID)?;
        let dimensions = endpoint.dimensions();
        if model.is_empty()
            || model.len() > 256
            || model.chars().any(char::is_control)
            || !(1..=65536).contains(&dimensions)
        {
            return Err(INVALID);
        }
        let binding = EmbeddingBinding {
            provider: route.provider,
            model: model.into(),
            dimensions,
            input_type_handling: route.input_semantics.as_str().into(),
            normalization: match endpoint.normalization() {
                EmbeddingNormalization::L2 => "l2",
                EmbeddingNormalization::None => "none",
            }
            .into(),
        };
        Ok(Self {
            endpoint,
            binding,
            input_semantics: route.input_semantics,
        })
    }

    pub(crate) fn hosted_identity(
        &self,
        general_provider: &str,
        general_model: &str,
    ) -> Result<HostedInferenceIdentity, &'static str> {
        HostedInferenceIdentity::new(
            general_provider,
            general_model,
            &self.binding.provider,
            &self.binding.model,
            self.binding.dimensions,
            self.input_semantics,
            self.endpoint.normalization(),
        )
        .map_err(|_| "inference_invalid_response")
    }
}

pub(crate) fn setup_check(state_dir: &Path) -> Result<(), &'static str> {
    if !state_dir.is_absolute() {
        return Err("invalid_state_directory");
    }
    let bytes = read_bounded(io::stdin().lock(), MAX_POINTER_BYTES)?;
    let request: CheckRequest = decode(&bytes).map_err(|_| "invalid_setup_request")?;
    let route = match request.config_path {
        Some(path) => EmbeddingRoute::open(&path),
        None => EmbeddingRoute::for_profile(state_dir),
    };
    serde_json::to_writer(
        io::stdout().lock(),
        &json!({"embedding_error": route.err()}),
    )
    .map_err(|_| "setup_response_unavailable")
}
