//! Durable host source authority. The store retains receipts and fingerprints.
use crate::{
    service_http::{HttpError, UNAVAILABLE, hex},
    source_wire::Evidence,
};
use reliquary_memory::OwnerId;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{ErrorKind, Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const MAX_STATE_BYTES: usize = 96 * 1024;
const MAX_RESUME_SCAN_ENTRIES: usize = 4096;

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
    #[serde(default)]
    pub(crate) session_id: Option<String>,
    #[serde(default)]
    pub(crate) owner_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) phy_id: Option<OwnerId>,
    #[serde(default)]
    pub(crate) manual: bool,
    pub(crate) generation: u64,
    pub(crate) available: bool,
    pub(crate) stale: bool,
    pub(crate) terminal: bool,
    pub(crate) accepted: Option<SourceHead>,
    pub(crate) pending: Option<SourceHead>,
}

#[derive(Clone)]
pub(crate) struct SourceStore {
    directory: PathBuf,
    resume_entries: Arc<Mutex<Option<fs::ReadDir>>>,
}

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
        // tempfile passes the paths directly to MoveFileExW. Use the canonical
        // extended path so the atomic receipt rename also works past MAX_PATH.
        let directory = fs::canonicalize(directory).map_err(|_| "source_state_unavailable")?;
        Ok(Self {
            directory,
            resume_entries: Arc::new(Mutex::new(None)),
        })
    }

    pub(crate) fn path(&self, session: &str) -> PathBuf {
        self.directory
            .join(format!("{}.json", hex(&Sha256::digest(session.as_bytes()))))
    }

    pub(crate) fn visit_resumable_imports(
        &self,
        mut visit: impl FnMut(String, String, String, bool, Option<OwnerId>) -> bool,
    ) {
        let Ok(mut entries) = self.resume_entries.lock() else {
            return;
        };
        if entries.is_none() {
            *entries = fs::read_dir(&self.directory).ok();
        }
        let mut scanned = 0;
        while scanned < MAX_RESUME_SCAN_ENTRIES {
            let next = entries.as_mut().and_then(Iterator::next);
            let Some(entry) = next else {
                *entries = fs::read_dir(&self.directory).ok();
                break;
            };
            scanned += 1;
            let Ok(entry) = entry else { continue };
            let path = entry.path();
            if !path
                .extension()
                .is_some_and(|extension| extension == "json")
            {
                continue;
            }
            let Ok(state) = self.read(&path) else {
                continue;
            };
            if state.terminal || state.stale || (!state.available && state.pending.is_none()) {
                continue;
            }
            let (Some(session), Some(head), Some(owner)) = (
                state.session_id.as_deref(),
                state.pending.as_ref().or(state.accepted.as_ref()),
                state.owner_id.as_deref(),
            ) else {
                continue;
            };
            if self.path(session) != path {
                continue;
            }
            if !visit(
                session.to_owned(),
                owner.to_owned(),
                head.import_id.clone(),
                state.manual,
                state.phy_id,
            ) {
                return;
            }
        }
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
        if state
            .session_id
            .as_deref()
            .is_some_and(|session| self.path(session) != path)
            || (state.phy_id.is_some() && state.owner_id.is_none())
            || (state.stale && state.available)
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
        let mut file = tempfile::NamedTempFile::new_in(&self.directory).map_err(|_| UNAVAILABLE)?;
        file.write_all(raw).map_err(|_| UNAVAILABLE)?;
        file.as_file().sync_all().map_err(|_| UNAVAILABLE)?;
        if replace {
            file.persist(path).map_err(|_| UNAVAILABLE)?;
        } else {
            file.persist_noclobber(path).map_err(|_| UNAVAILABLE)?;
        }
        #[cfg(unix)]
        File::open(&self.directory)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| UNAVAILABLE)?;
        Ok(())
    }
}

#[cfg(test)]
mod resumable_import_tests {
    use super::*;

    #[test]
    fn restart_scan_returns_pending_and_accepted_heads_for_manual_and_normal_sources() {
        let scratch = Path::new(env!("CARGO_MANIFEST_DIR")).join(".test-tmp");
        fs::create_dir_all(&scratch).unwrap();
        let directory = tempfile::tempdir_in(&scratch).unwrap();
        let store = SourceStore::open(directory.path()).unwrap();
        let phy = OwnerId::from_bytes([2; 16]);
        for (session, manual) in [("normal", false), ("selected-manual", true)] {
            let path = store.path(session);
            let mut state = SourceState::default();
            state.session_id = Some(session.to_owned());
            state.owner_id = Some("configured-rel".to_owned());
            state.manual = manual;
            state.phy_id = manual.then_some(phy);
            state.accepted = Some(SourceHead {
                wire_digest: "a".repeat(64),
                request_key: "b".repeat(64),
                native_digest: [1; 32],
                import_id: format!("import-{session}"),
                branch: None,
                evidence: Vec::new(),
                receipt: Some([2; 32]),
            });
            state.available = true;
            store.write(&path, &state).unwrap();
        }
        let mut seen = Vec::new();
        store.visit_resumable_imports(|session, owner, import_id, manual, phy| {
            seen.push((session, owner, import_id, manual, phy));
            seen.len() < 130
        });
        seen.sort();
        assert_eq!(
            seen,
            vec![
                (
                    "normal".to_owned(),
                    "configured-rel".to_owned(),
                    "import-normal".to_owned(),
                    false,
                    None,
                ),
                (
                    "selected-manual".to_owned(),
                    "configured-rel".to_owned(),
                    "import-selected-manual".to_owned(),
                    true,
                    Some(phy),
                ),
            ]
        );
    }

    #[test]
    fn bounded_resume_scan_rotates_until_entries_after_the_first_window_are_seen() {
        let scratch = Path::new(env!("CARGO_MANIFEST_DIR")).join(".test-tmp");
        fs::create_dir_all(&scratch).unwrap();
        let directory = tempfile::tempdir_in(&scratch).unwrap();
        let store = SourceStore::open(directory.path()).unwrap();
        for index in 0..=MAX_RESUME_SCAN_ENTRIES {
            let session = format!("source-{index:04}");
            let path = store.path(&session);
            let mut state = SourceState::default();
            state.session_id = Some(session);
            state.owner_id = Some("configured-rel".to_owned());
            state.available = true;
            state.accepted = Some(SourceHead {
                wire_digest: "a".repeat(64),
                request_key: "b".repeat(64),
                native_digest: [1; 32],
                import_id: format!("import-{index}"),
                branch: None,
                evidence: Vec::new(),
                receipt: Some([2; 32]),
            });
            store.write(&path, &state).unwrap();
        }

        let mut first = Vec::new();
        store.visit_resumable_imports(|session, _, _, _, _| {
            first.push(session);
            true
        });
        assert_eq!(first.len(), MAX_RESUME_SCAN_ENTRIES);

        let mut second = Vec::new();
        store.visit_resumable_imports(|session, _, _, _, _| {
            second.push(session);
            true
        });
        assert_eq!(second.len(), 1);
        let mut all = first;
        all.extend(second);
        all.sort();
        all.dedup();
        assert_eq!(all.len(), MAX_RESUME_SCAN_ENTRIES + 1);
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn atomically_writes_receipt_under_a_long_profile_path() {
        let scratch = tempfile::tempdir().unwrap();
        let store = SourceStore::open(&scratch.path().join("profile".repeat(20))).unwrap();
        let path = store.path("session");
        let key = "a".repeat(64);
        assert!(
            path.with_extension(format!("{key}.receipt"))
                .as_os_str()
                .len()
                > 260
        );

        let receipt = [1; 32];
        store.write_receipt(&path, &key, receipt).unwrap();
        assert_eq!(store.read_receipt(&path, &key).unwrap(), Some(receipt));
    }
}
