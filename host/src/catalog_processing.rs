//! Catalog model routes contain no credentials. Hermes supplies the API key to
//! this child process; Root configuration is assembled in memory and never saved.
use reliquary_memory::{
    ConfiguredRuntime, CredentialId, DecisionModelEndpoint, EmbeddingModelEndpoint,
    EmbeddingNormalization, GeneralModelEndpoint, GeneralRoute, ModelProvider, ModelRoute,
    ModelSlot, ReliquaryConfig, SecretString,
};
use serde::Deserialize;
use std::{fs::File, io::Read, path::Path};

const INVALID: &str = "invalid_processing_config";
const KEY: &str = "RELIQUARY_PROVIDER_API_KEY";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Route {
    model: String,
    url: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Embedding {
    model: String,
    url: String,
    dimensions: u32,
    #[serde(default = "default_normalization")]
    normalization: Normalization,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Normalization {
    None,
    L2,
}

fn default_normalization() -> Normalization {
    Normalization::L2
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Routes {
    general: Option<Route>,
    embedding: Option<Embedding>,
    decision: Option<Route>,
}

pub(crate) fn open(path: &Path) -> Result<ConfiguredRuntime, &'static str> {
    if !path.is_absolute() || !path.is_file() {
        return Err(INVALID);
    }
    let mut raw = Vec::new();
    File::open(path)
        .and_then(|file| file.take(8193).read_to_end(&mut raw))
        .map_err(|_| INVALID)?;
    if raw.len() > 8192 {
        return Err(INVALID);
    }
    // This environment is built by the Python adapter from get_secret(), not
    // inherited from the shell or another Hermes profile.
    let secret = std::env::var(KEY).ok();
    build(path, &raw, secret.as_deref())
}

fn endpoint(model: &str, url: &str) -> Result<(), &'static str> {
    let allowed = url.starts_with("https://")
        || url.starts_with("http://127.0.0.1:")
        || url.starts_with("http://localhost:")
        || url.starts_with("http://[::1]:");
    if model.trim().is_empty()
        || model.len() > 256
        || url.len() > 2048
        || !allowed
        || url.contains('@')
        || url.chars().any(char::is_control)
    {
        return Err(INVALID);
    }
    Ok(())
}

fn build(path: &Path, raw: &[u8], secret: Option<&str>) -> Result<ConfiguredRuntime, &'static str> {
    let routes: Routes = crate::service_protocol::decode(raw).map_err(|_| INVALID)?;
    // new_blank is an in-memory constructor. Never call open(), from_path(),
    // save(), login_codex(), or refresh_codex() on the catalog path.
    let mut config = ReliquaryConfig::new_blank(path);
    let credential_id = CredentialId::new("hermes-provider").map_err(|_| INVALID)?;
    if routes.general.is_some() || routes.embedding.is_some() || routes.decision.is_some() {
        let secret = secret
            .filter(|value| !value.trim().is_empty())
            .ok_or("processing_key_required")?;
        config.add_api_key(
            credential_id.clone(),
            SecretString::new(secret).map_err(|_| INVALID)?,
        );
    }
    if let Some(route) = routes.general {
        endpoint(&route.model, &route.url)?;
        for slot in [
            ModelSlot::General,
            ModelSlot::Insomnia,
            ModelSlot::InsomniaMetadata,
            ModelSlot::EntityExtraction,
            ModelSlot::EntityResolution,
            ModelSlot::Dream,
        ] {
            config
                .set_model(
                    slot,
                    &ModelRoute::General(GeneralRoute {
                        endpoint: GeneralModelEndpoint {
                            provider: ModelProvider::OpenAiReady,
                            model: route.model.clone(),
                            url: route.url.clone(),
                            credential_id: credential_id.clone(),
                        },
                        reasoning_effort: None,
                    }),
                )
                .map_err(|_| INVALID)?;
        }
    }
    if let Some(route) = routes.embedding {
        endpoint(&route.model, &route.url)?;
        config
            .set_model(
                ModelSlot::Embedding,
                &ModelRoute::Embedding(EmbeddingModelEndpoint {
                    provider: ModelProvider::OpenAiReady,
                    model: route.model,
                    url: route.url,
                    credential_id: credential_id.clone(),
                    dimensions: route.dimensions,
                    normalization: match route.normalization {
                        Normalization::None => EmbeddingNormalization::None,
                        Normalization::L2 => EmbeddingNormalization::L2,
                    },
                }),
            )
            .map_err(|_| INVALID)?;
    }
    if let Some(route) = routes.decision {
        endpoint(&route.model, &route.url)?;
        for slot in [
            ModelSlot::GeneralDecision,
            ModelSlot::EntityResolutionDecision,
            ModelSlot::MemoryRetrievalDecision,
        ] {
            config
                .set_model(
                    slot,
                    &ModelRoute::Decision(DecisionModelEndpoint {
                        model: route.model.clone(),
                        url: route.url.clone(),
                        credential_id: credential_id.clone(),
                    }),
                )
                .map_err(|_| INVALID)?;
        }
    }
    config.configured_runtime().map_err(|_| INVALID)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_credential_fields_and_legacy_store_bytes() {
        let path = Path::new("unused.json");
        assert!(build(path, br#"{"api_key":"forbidden"}"#, Some("fixture")).is_err());
        assert!(build(path, b"CVCFG\0", Some("fixture")).is_err());
    }

    #[test]
    fn builds_without_creating_a_store_and_requires_scoped_key() {
        let scratch = Path::new(env!("CARGO_MANIFEST_DIR")).join(".test-tmp");
        std::fs::create_dir_all(&scratch).unwrap();
        let directory = tempfile::tempdir_in(scratch).unwrap();
        let path = directory.path().join("not-created.json");
        let raw =
            br#"{"general":{"model":"fixture","url":"http://127.0.0.1:1234/v1/chat/completions"}}"#;
        assert_eq!(
            build(&path, raw, None).unwrap_err(),
            "processing_key_required"
        );
        assert!(build(&path, raw, Some("synthetic-api-key")).is_ok());
        assert!(!path.exists());
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[test]
    fn rejects_remote_plaintext_and_url_credentials() {
        assert!(endpoint("fixture", "http://example.com/v1").is_err());
        assert!(endpoint("fixture", "https://user:pass@example.com/v1").is_err());
        assert!(endpoint("fixture", "https://example.com/v1").is_ok());
    }
}
