//! Durable, nonsecret per-owner evidence for the hosted embedding route.
use reliquary_memory::OwnerId;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

const DIRECTORY: &str = "embedding-identities-v1";
const MAX_BYTES: u64 = 4096;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EmbeddingBinding {
    pub(crate) provider: String,
    pub(crate) model: String,
    pub(crate) dimensions: u32,
    pub(crate) input_type_handling: String,
    pub(crate) normalization: String,
}

pub(crate) struct EmbeddingBindingStore {
    directory: PathBuf,
    serial: Mutex<()>,
}

impl EmbeddingBindingStore {
    pub(crate) fn open(state_dir: &Path) -> Result<Self, &'static str> {
        let directory = state_dir.join(DIRECTORY);
        match directory.symlink_metadata() {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Ok(_) => return Err("embedding_identity_unavailable"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let builder = fs::DirBuilder::new();
                #[cfg(unix)]
                {
                    use std::os::unix::fs::DirBuilderExt;
                    builder.mode(0o700);
                }
                builder
                    .create(&directory)
                    .map_err(|_| "embedding_identity_unavailable")?;
            }
            Err(_) => return Err("embedding_identity_unavailable"),
        }
        Ok(Self {
            directory,
            serial: Mutex::new(()),
        })
    }

    pub(crate) fn ensure_owner(
        &self,
        owner: OwnerId,
        expected: &EmbeddingBinding,
        has_active_vectors: impl FnOnce() -> Result<bool, ()>,
    ) -> Result<(), &'static str> {
        let _serial = self
            .serial
            .lock()
            .map_err(|_| "embedding_identity_unavailable")?;
        let path = self.path(owner);
        match read_marker(&path)? {
            Some(actual) if &actual == expected => Ok(()),
            Some(_) => Err("embedding_identity_stale"),
            None => {
                if has_active_vectors().map_err(|_| "embedding_identity_unavailable")? {
                    Err("embedding_identity_unbound")
                } else {
                    self.write_marker(&path, expected)
                }
            }
        }
    }

    pub(crate) fn status_owner(
        &self,
        owner: OwnerId,
        expected: &EmbeddingBinding,
        has_active_vectors: impl FnOnce() -> Result<bool, ()>,
    ) -> Result<Option<&'static str>, &'static str> {
        match read_marker(&self.path(owner))? {
            Some(actual) if &actual == expected => Ok(None),
            Some(_) => Ok(Some("embedding_identity_stale")),
            None if has_active_vectors().map_err(|_| "embedding_identity_unavailable")? => {
                Ok(Some("embedding_identity_unbound"))
            }
            None => Ok(None),
        }
    }

    fn path(&self, owner: OwnerId) -> PathBuf {
        self.directory.join(format!("{}.json", owner))
    }

    fn write_marker(&self, path: &Path, binding: &EmbeddingBinding) -> Result<(), &'static str> {
        let mut temporary = tempfile::Builder::new()
            .prefix(".embedding-identity-")
            .tempfile_in(&self.directory)
            .map_err(|_| "embedding_identity_unavailable")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            temporary
                .as_file()
                .set_permissions(fs::Permissions::from_mode(0o600))
                .map_err(|_| "embedding_identity_unavailable")?;
        }
        serde_json::to_writer(&mut temporary, binding)
            .map_err(|_| "embedding_identity_unavailable")?;
        temporary
            .write_all(b"\n")
            .and_then(|()| temporary.as_file().sync_all())
            .map_err(|_| "embedding_identity_unavailable")?;
        match temporary.persist_noclobber(path) {
            Ok(_) => {
                #[cfg(unix)]
                File::open(&self.directory)
                    .and_then(|directory| directory.sync_all())
                    .map_err(|_| "embedding_identity_unavailable")?;
                Ok(())
            }
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
                match read_marker(path)? {
                    Some(actual) if &actual == binding => Ok(()),
                    _ => Err("embedding_identity_stale"),
                }
            }
            Err(_) => Err("embedding_identity_unavailable"),
        }
    }
}

fn read_marker(path: &Path) -> Result<Option<EmbeddingBinding>, &'static str> {
    let metadata = match path.symlink_metadata() {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => metadata,
        Ok(_) => return Err("embedding_identity_unavailable"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("embedding_identity_unavailable"),
    };
    if metadata.len() > MAX_BYTES {
        return Err("embedding_identity_unavailable");
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(path)
        .and_then(|file| file.take(MAX_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|_| "embedding_identity_unavailable")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("embedding_identity_unavailable");
    }
    crate::service_protocol::decode(&bytes)
        .map(Some)
        .map_err(|_| "embedding_identity_unavailable")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding(model: &str) -> EmbeddingBinding {
        EmbeddingBinding {
            provider: "openai-api".into(),
            model: model.into(),
            dimensions: 3,
            input_type_handling: "shared".into(),
            normalization: "none".into(),
        }
    }

    #[test]
    fn marker_is_immutable_and_survives_store_reopen() {
        let temp = tempfile::tempdir().unwrap();
        let store = EmbeddingBindingStore::open(temp.path()).unwrap();
        let owner = "00000000000000000000000000000001".parse().unwrap();
        let path = store.path(owner);
        store.write_marker(&path, &binding("model-a")).unwrap();
        let reopened = EmbeddingBindingStore::open(temp.path()).unwrap();
        assert_eq!(
            read_marker(&reopened.path(owner)).unwrap(),
            Some(binding("model-a"))
        );
        assert_eq!(
            reopened.write_marker(&reopened.path(owner), &binding("model-b")),
            Err("embedding_identity_stale")
        );
    }

    #[test]
    fn marker_contains_no_credentials_or_prompt_content() {
        let temp = tempfile::tempdir().unwrap();
        let store = EmbeddingBindingStore::open(temp.path()).unwrap();
        let owner = "00000000000000000000000000000002".parse().unwrap();
        let path = store.path(owner);
        store.write_marker(&path, &binding("model-a")).unwrap();
        let content = fs::read_to_string(path).unwrap();
        assert!(content.contains("model-a"));
        assert!(!content.contains("key"));
        assert!(!content.contains("prompt"));
    }

    #[test]
    fn legacy_vectors_require_explicit_identity_evidence() {
        let temp = tempfile::tempdir().unwrap();
        let store = EmbeddingBindingStore::open(temp.path()).unwrap();
        let owner = "00000000000000000000000000000003".parse().unwrap();
        assert_eq!(
            store.ensure_owner(owner, &binding("model-a"), || Ok(true)),
            Err("embedding_identity_unbound")
        );
        assert!(!store.path(owner).exists());
        assert_eq!(
            store.ensure_owner(owner, &binding("model-a"), || Ok(false)),
            Ok(())
        );
        let reopened = EmbeddingBindingStore::open(temp.path()).unwrap();
        assert_eq!(
            reopened.ensure_owner(owner, &binding("model-a"), || panic!(
                "marker must short-circuit"
            )),
            Ok(())
        );
        assert_eq!(
            reopened.ensure_owner(owner, &binding("model-b"), || panic!(
                "mismatch must fail before probing"
            )),
            Err("embedding_identity_stale")
        );
    }

    #[test]
    fn untrusted_active_vector_check_fails_closed() {
        let temp = tempfile::tempdir().unwrap();
        let store = EmbeddingBindingStore::open(temp.path()).unwrap();
        let owner = "00000000000000000000000000000004".parse().unwrap();
        assert_eq!(
            store.ensure_owner(owner, &binding("model-a"), || Err(())),
            Err("embedding_identity_unavailable")
        );
        assert!(!store.path(owner).exists());
    }

    #[test]
    fn status_inspection_is_read_only_and_distinguishes_stale_legacy_from_new_owner() {
        let temp = tempfile::tempdir().unwrap();
        let store = EmbeddingBindingStore::open(temp.path()).unwrap();
        let owner = "00000000000000000000000000000005".parse().unwrap();
        assert_eq!(
            store.status_owner(owner, &binding("model-a"), || Ok(false)),
            Ok(None)
        );
        assert!(!store.path(owner).exists());
        assert_eq!(
            store.status_owner(owner, &binding("model-a"), || Ok(true)),
            Ok(Some("embedding_identity_unbound"))
        );
        store
            .write_marker(&store.path(owner), &binding("model-a"))
            .unwrap();
        assert_eq!(
            store.status_owner(owner, &binding("model-b"), || panic!(
                "a stale marker must short-circuit vector inspection"
            )),
            Ok(Some("embedding_identity_stale"))
        );
    }
}
