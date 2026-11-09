//! Durable liveness leases for external integration runtimes.
//!
//! These leases are intentionally independent of Reliquary owner and service
//! leases. A crash fence records only that a source scope needs authoritative
//! reconciliation; it makes no claim about which upstream event was missed.
use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::fs::File;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tempfile::NamedTempFile;

pub(crate) const HEARTBEAT_SECONDS: u64 = 15;
pub(crate) const EXPIRY_SECONDS: u64 = 60;

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
pub(crate) struct ScopeFence {
    pub(crate) integration_kind: String,
    pub(crate) runtime_id: String,
    pub(crate) lease_id: String,
    pub(crate) principal_id: String,
    pub(crate) session_id: String,
    pub(crate) epoch: u64,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct ReconciliationScope {
    pub(crate) session_id: String,
    pub(crate) fence_epoch: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Lease {
    lease_id: String,
    integration_kind: String,
    runtime_id: String,
    principal_id: String,
    scopes: BTreeSet<String>,
    observed_fences: BTreeMap<String, u64>,
    expires_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct UnscopedCrash {
    integration_kind: String,
    runtime_id: String,
    lease_id: String,
    principal_id: String,
    epoch: u64,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct State {
    leases: BTreeMap<String, Lease>,
    fences: BTreeSet<ScopeFence>,
    shutdown_armed: bool,
    next_fence_epoch: u64,
    unscoped_crashes: Vec<UnscopedCrash>,
}

pub(crate) struct RuntimeRegistry {
    path: PathBuf,
    state: State,
    clock_origin: Instant,
    wall_origin: u64,
}

impl RuntimeRegistry {
    pub(crate) fn open(state_dir: &Path) -> Result<Self, &'static str> {
        let state_dir = state_dir
            .canonicalize()
            .map_err(|_| "runtime_state_unavailable")?;
        let path = state_dir.join("integration-runtimes-v1.json");
        let mut state = match fs::read(&path) {
            Ok(bytes) => {
                serde_json::from_slice::<State>(&bytes).map_err(|_| "runtime_state_invalid")?
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => State::default(),
            Err(_) => return Err("runtime_state_unavailable"),
        };
        // A host restart cannot prove that previously live adapter processes
        // detached cleanly. Fence their scopes before allowing new work.
        for (_, lease) in std::mem::take(&mut state.leases) {
            if lease.scopes.is_empty() {
                insert_unscoped_crash(&mut state, &lease);
            } else {
                for session_id in lease.scopes.iter().cloned() {
                    insert_fence(&mut state, &lease, session_id);
                }
            }
        }
        let registry = Self {
            path,
            state,
            clock_origin: Instant::now(),
            wall_origin: wall_time()?,
        };
        // A new host lifetime only shuts down after its own final clean detach.
        let mut registry = registry;
        registry.state.shutdown_armed = false;
        registry.persist()?;
        Ok(registry)
    }

    pub(crate) fn attach(
        &mut self,
        lease_id: String,
        integration_kind: String,
        runtime_id: String,
        principal_id: String,
        session_id: Option<String>,
    ) -> Result<(String, Vec<ReconciliationScope>), &'static str> {
        self.expire()?;
        if self.state.shutdown_armed {
            return Err("host_closing");
        }
        let observed_fence = session_id
            .as_deref()
            .and_then(|session| current_fence(&self.state, &integration_kind, session));
        if let Some((existing_id, _)) = self.state.leases.iter().find(|(_, lease)| {
            lease.integration_kind == integration_kind
                && lease.runtime_id == runtime_id
                && lease.principal_id == principal_id
        }) {
            let existing_id = existing_id.clone();
            let mut candidate = self.state.clone();
            let lease = candidate
                .leases
                .get_mut(&existing_id)
                .ok_or("runtime_state_invalid")?;
            if let Some(session_id) = session_id.as_ref() {
                lease.scopes.insert(session_id.clone());
                if let Some(epoch) = observed_fence {
                    lease.observed_fences.insert(session_id.clone(), epoch);
                }
            }
            lease.expires_at = self.now().saturating_add(EXPIRY_SECONDS);
            let result = observed_fence
                .zip(session_id.clone())
                .map(|(fence_epoch, session_id)| {
                    vec![ReconciliationScope {
                        session_id,
                        fence_epoch,
                    }]
                })
                .unwrap_or_default();
            persist_state(&self.path, &candidate)?;
            self.state = candidate;
            return Ok((existing_id, result));
        }
        let mut scopes = BTreeSet::new();
        if let Some(session_id) = session_id.as_ref() {
            scopes.insert(session_id.clone());
        }
        let mut observed_fences = BTreeMap::new();
        if let (Some(session_id), Some(epoch)) = (&session_id, observed_fence) {
            observed_fences.insert(session_id.clone(), epoch);
        }
        let mut candidate = self.state.clone();
        candidate.leases.insert(
            lease_id.clone(),
            Lease {
                lease_id: lease_id.clone(),
                integration_kind,
                runtime_id,
                principal_id,
                scopes,
                observed_fences,
                expires_at: self.now().saturating_add(EXPIRY_SECONDS),
            },
        );
        candidate.shutdown_armed = false;
        persist_state(&self.path, &candidate)?;
        self.state = candidate;
        Ok((
            lease_id,
            observed_fence
                .zip(session_id)
                .map(|(fence_epoch, session_id)| {
                    vec![ReconciliationScope {
                        session_id,
                        fence_epoch,
                    }]
                })
                .unwrap_or_default(),
        ))
    }

    pub(crate) fn heartbeat(
        &mut self,
        lease_id: &str,
        principal: &str,
    ) -> Result<(), &'static str> {
        self.expire()?;
        let mut candidate = self.state.clone();
        let lease = candidate
            .leases
            .get_mut(lease_id)
            .ok_or("runtime_lease_stale")?;
        if lease.principal_id != principal {
            return Err("runtime_lease_denied");
        }
        lease.expires_at = self.now().saturating_add(EXPIRY_SECONDS);
        persist_state(&self.path, &candidate)?;
        self.state = candidate;
        Ok(())
    }

    pub(crate) fn add_scope(
        &mut self,
        lease_id: &str,
        principal: &str,
        session_id: String,
    ) -> Result<(String, Vec<ReconciliationScope>), &'static str> {
        self.expire()?;
        let integration = self
            .state
            .leases
            .get(lease_id)
            .ok_or("runtime_lease_stale")?;
        if integration.principal_id != principal {
            return Err("runtime_lease_denied");
        }
        let integration_kind = integration.integration_kind.clone();
        let observed = current_fence(&self.state, &integration_kind, &session_id);
        let mut candidate = self.state.clone();
        let lease = candidate
            .leases
            .get_mut(lease_id)
            .ok_or("runtime_lease_stale")?;
        lease.scopes.insert(session_id.clone());
        if let Some(epoch) = observed {
            lease.observed_fences.insert(session_id.clone(), epoch);
        }
        persist_state(&self.path, &candidate)?;
        self.state = candidate;
        let scopes = observed
            .map(|fence_epoch| {
                vec![ReconciliationScope {
                    session_id,
                    fence_epoch,
                }]
            })
            .unwrap_or_default();
        Ok((integration_kind, scopes))
    }

    pub(crate) fn authorize_scope(
        &mut self,
        lease_id: &str,
        principal: &str,
        session_id: &str,
    ) -> Result<(String, bool, Option<u64>), &'static str> {
        self.expire()?;
        let lease = self
            .state
            .leases
            .get(lease_id)
            .ok_or("runtime_lease_stale")?;
        if lease.principal_id != principal || !lease.scopes.contains(session_id) {
            return Err("runtime_lease_denied");
        }
        let current = current_fence(&self.state, &lease.integration_kind, session_id);
        let observed = lease.observed_fences.get(session_id).copied();
        Ok((
            lease.integration_kind.clone(),
            current.is_some(),
            if current == observed { current } else { None },
        ))
    }

    pub(crate) fn has_fence(
        &mut self,
        integration: &str,
        session: &str,
    ) -> Result<bool, &'static str> {
        self.expire()?;
        Ok(current_fence(&self.state, integration, session).is_some())
    }

    pub(crate) fn current_fence_epoch(
        &mut self,
        integration: &str,
        session: &str,
    ) -> Result<Option<u64>, &'static str> {
        self.expire()?;
        Ok(current_fence(&self.state, integration, session))
    }

    pub(crate) fn detach(&mut self, lease_id: &str, principal: &str) -> Result<bool, &'static str> {
        self.expire()?;
        let lease = self
            .state
            .leases
            .get(lease_id)
            .ok_or("runtime_lease_stale")?;
        if lease.principal_id != principal {
            return Err("runtime_lease_denied");
        }
        let mut candidate = self.state.clone();
        candidate.leases.remove(lease_id);
        if candidate.leases.is_empty() && candidate.fences.is_empty() {
            candidate.shutdown_armed = true;
        }
        persist_state(&self.path, &candidate)?;
        self.state = candidate;
        Ok(self.state.shutdown_armed
            && self.state.leases.is_empty()
            && self.state.fences.is_empty())
    }

    pub(crate) fn clear_fence(
        &mut self,
        integration: &str,
        session: &str,
        epoch: Option<u64>,
    ) -> Result<(), &'static str> {
        let mut candidate = self.state.clone();
        let before = candidate.fences.len();
        if let Some(epoch) = epoch {
            candidate.fences.retain(|item| {
                !(item.integration_kind == integration
                    && item.session_id == session
                    && item.epoch <= epoch)
            });
        }
        if candidate.fences.len() != before {
            persist_state(&self.path, &candidate)?;
            self.state = candidate;
        }
        Ok(())
    }

    pub(crate) fn expire(&mut self) -> Result<usize, &'static str> {
        let now = self.now();
        let expired: Vec<String> = self
            .state
            .leases
            .iter()
            .filter(|(_, lease)| lease.expires_at <= now)
            .map(|(id, _)| id.clone())
            .collect();
        if expired.is_empty() {
            return Ok(0);
        }
        let mut candidate = self.state.clone();
        for id in &expired {
            if let Some(lease) = candidate.leases.remove(id) {
                for session_id in lease.scopes.iter().cloned() {
                    insert_fence(&mut candidate, &lease, session_id);
                }
                if lease.scopes.is_empty() {
                    insert_unscoped_crash(&mut candidate, &lease);
                }
            }
        }
        // Persist crash markers before the service considers those scopes stale.
        persist_state(&self.path, &candidate)?;
        self.state = candidate;
        Ok(expired.len())
    }

    pub(crate) fn should_shutdown(&mut self) -> Result<bool, &'static str> {
        self.expire()?;
        Ok(self.state.shutdown_armed
            && self.state.leases.is_empty()
            && self.state.fences.is_empty())
    }

    fn now(&self) -> u64 {
        // Keep persisted renewal deadlines readable as Unix time, while
        // measuring elapsed liveness on the host's monotonic clock.
        self.wall_origin
            .saturating_add(self.clock_origin.elapsed().as_secs())
    }

    fn persist(&self) -> Result<(), &'static str> {
        persist_state(&self.path, &self.state)
    }
}

fn persist_state(path: &Path, state: &State) -> Result<(), &'static str> {
    let directory = path.parent().ok_or("runtime_state_unavailable")?;
    let mut temporary =
        NamedTempFile::new_in(directory).map_err(|_| "runtime_state_unavailable")?;
    serde_json::to_writer(&mut temporary, state).map_err(|_| "runtime_state_unavailable")?;
    temporary
        .write_all(b"\n")
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|_| "runtime_state_unavailable")?;
    temporary
        .persist(path)
        .map_err(|_| "runtime_state_unavailable")?;
    #[cfg(unix)]
    File::open(directory)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| "runtime_state_unavailable")?;
    Ok(())
}

fn wall_time() -> Result<u64, &'static str> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| "runtime_clock_invalid")
}

fn current_fence(state: &State, integration: &str, session: &str) -> Option<u64> {
    state
        .fences
        .iter()
        .filter(|item| item.integration_kind == integration && item.session_id == session)
        .map(|item| item.epoch)
        .max()
}

fn insert_fence(state: &mut State, lease: &Lease, session: String) {
    state.next_fence_epoch = state.next_fence_epoch.saturating_add(1);
    state.fences.insert(ScopeFence {
        integration_kind: lease.integration_kind.clone(),
        runtime_id: lease.runtime_id.clone(),
        lease_id: lease.lease_id.clone(),
        principal_id: lease.principal_id.clone(),
        session_id: session,
        epoch: state.next_fence_epoch,
    });
}

fn insert_unscoped_crash(state: &mut State, lease: &Lease) {
    state.next_fence_epoch = state.next_fence_epoch.saturating_add(1);
    state.unscoped_crashes.push(UnscopedCrash {
        integration_kind: lease.integration_kind.clone(),
        runtime_id: lease.runtime_id.clone(),
        lease_id: lease.lease_id.clone(),
        principal_id: lease.principal_id.clone(),
        epoch: state.next_fence_epoch,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attach(registry: &mut RuntimeRegistry, lease: &str, runtime: &str, session: Option<&str>) {
        registry
            .attach(
                lease.to_owned(),
                "example".to_owned(),
                runtime.to_owned(),
                "principal".to_owned(),
                session.map(str::to_owned),
            )
            .unwrap();
    }

    #[test]
    fn optional_scope_expiry_records_crash_and_only_last_clean_detach_shuts_down() {
        let directory = tempfile::tempdir().unwrap();
        let mut registry = RuntimeRegistry::open(directory.path()).unwrap();
        attach(&mut registry, "lease-one", "runtime-one", None);
        attach(
            &mut registry,
            "lease-two",
            "runtime-two",
            Some("opaque-scope"),
        );
        attach(&mut registry, "lease-three", "runtime-three", None);

        let late_renewal = registry.now() + 15;
        registry
            .state
            .leases
            .get_mut("lease-three")
            .unwrap()
            .expires_at = late_renewal;
        registry.heartbeat("lease-three", "principal").unwrap();
        assert!(registry.state.leases["lease-three"].expires_at > late_renewal);
        assert_eq!(registry.expire().unwrap(), 0);

        // An unscoped crash is durably recorded without inventing a source fence.
        registry
            .state
            .leases
            .get_mut("lease-one")
            .unwrap()
            .expires_at = 0;
        assert_eq!(registry.expire().unwrap(), 1);
        assert!(registry.state.fences.is_empty());
        assert_eq!(registry.state.unscoped_crashes.len(), 1);
        assert!(!registry.should_shutdown().unwrap());

        assert!(!registry.detach("lease-two", "principal").unwrap());
        assert!(registry.detach("lease-three", "principal").unwrap());
        assert!(registry.should_shutdown().unwrap());
    }
}
