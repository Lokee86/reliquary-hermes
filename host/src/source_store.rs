//! Durable host source authority. The store retains receipts and fingerprints.
use crate::{
    service_http::{HttpError, UNAVAILABLE, hex},
    source_wire::Evidence,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{ErrorKind, Read, Write},
    path::{Path, PathBuf},
};

const MAX_STATE_BYTES: usize = 96 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SourceHead {
    pub(crate) wire_digest: String,
    pub(crate) request_key: String,
    pub(crate) native_digest: [u8; 32],
    pub(crate) import_id: String,
    pub(crate) branch: Option<String>,
    pub(crate) evidence: Vec<Evidence>,
    pub(crate) receipt: Option<[u8; 32]>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SourceState {
    pub(crate) generation: u64,
    pub(crate) available: bool,
    pub(crate) stale: bool,
    pub(crate) terminal: bool,
    pub(crate) accepted: Option<SourceHead>,
    pub(crate) pending: Option<SourceHead>,
}

pub(crate) struct SourceStore(PathBuf);

impl SourceStore {
    pub(crate) fn open(state_dir: &Path) -> Result<Self, &'static str> {
        let directory = state_dir.join("sources-v1");
        fs::create_dir_all(&directory).map_err(|_| "source_state_unavailable")?;
        if !directory
            .symlink_metadata()
            .is_ok_and(|metadata| metadata.is_dir())
        {
            return Err("source_state_unavailable");
        }
        Ok(Self(directory))
    }

    pub(crate) fn path(&self, session: &str) -> PathBuf {
        self.0
            .join(format!("{}.json", hex(&Sha256::digest(session.as_bytes()))))
    }

    pub(crate) fn read(&self, path: &Path) -> Result<SourceState, HttpError> {
        match path.symlink_metadata() {
            Ok(metadata) if metadata.is_file() => {}
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(SourceState::default()),
            _ => return Err(UNAVAILABLE),
        }
        let mut raw = Vec::new();
        File::open(path)
            .and_then(|file| file.take(MAX_STATE_BYTES as u64 + 1).read_to_end(&mut raw))
            .map_err(|_| UNAVAILABLE)?;
        if raw.len() > MAX_STATE_BYTES {
            return Err(UNAVAILABLE);
        }
        let state: SourceState = crate::service_protocol::decode(&raw).map_err(|_| UNAVAILABLE)?;
        if (state.stale && state.available)
            || state
                .accepted
                .as_ref()
                .is_some_and(|head| head.receipt.is_none())
            || state
                .pending
                .as_ref()
                .is_some_and(|head| head.receipt.is_some())
            || (state.terminal && state.available)
            || state.generation > i64::MAX as u64
        {
            return Err(UNAVAILABLE);
        }
        Ok(state)
    }

    pub(crate) fn read_receipt(
        &self,
        path: &Path,
        key: &str,
    ) -> Result<Option<[u8; 32]>, HttpError> {
        let path = path.with_extension(format!("{key}.receipt"));
        match path.symlink_metadata() {
            Ok(metadata) if metadata.is_file() && metadata.len() == 32 => {}
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            _ => return Err(UNAVAILABLE),
        }
        let mut receipt = [0; 32];
        File::open(path)
            .and_then(|mut file| file.read_exact(&mut receipt))
            .map_err(|_| UNAVAILABLE)?;
        Ok(Some(receipt))
    }

    pub(crate) fn write_receipt(
        &self,
        path: &Path,
        key: &str,
        receipt: [u8; 32],
    ) -> Result<(), HttpError> {
        if let Some(existing) = self.read_receipt(path, key)? {
            return if existing == receipt {
                Ok(())
            } else {
                Err(UNAVAILABLE)
            };
        }
        let path = path.with_extension(format!("{key}.receipt"));
        self.save(&path, &receipt, false)
    }

    pub(crate) fn write(&self, path: &Path, state: &SourceState) -> Result<(), HttpError> {
        let raw = serde_json::to_vec(state).map_err(|_| UNAVAILABLE)?;
        if raw.len() > MAX_STATE_BYTES {
            return Err(UNAVAILABLE);
        }
        self.save(path, &raw, true)
    }

    fn save(&self, path: &Path, raw: &[u8], replace: bool) -> Result<(), HttpError> {
        let mut file = tempfile::NamedTempFile::new_in(&self.0).map_err(|_| UNAVAILABLE)?;
        file.write_all(raw).map_err(|_| UNAVAILABLE)?;
        file.as_file().sync_all().map_err(|_| UNAVAILABLE)?;
        if replace {
            file.persist(path).map_err(|_| UNAVAILABLE)?;
        } else {
            file.persist_noclobber(path).map_err(|_| UNAVAILABLE)?;
        }
        #[cfg(unix)]
        File::open(&self.0)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| UNAVAILABLE)?;
        Ok(())
    }
}
