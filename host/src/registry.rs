//! Service-owned owner topology and durable Hermes session binding.
use reliquary_memory::{
    Gateway, HostAdmissionAdapter, HostCredentialBinding, InspectionQuery, Instance,
    MemoryListFilters, OwnerGrant, OwnerId, OwnerKind, OwnerScope, Phylactery, ProductError,
    ProductErrorKind, Rel, TrustedHostAdmission,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    fs::{File, OpenOptions, TryLockError},
    path::{Path, PathBuf},
};

#[path = "registry_store.rs"]
mod store;

#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct OwnerConfig {
    profile_id: String,
    principal_id: String,
    main_rel: PathBuf,
    #[serde(deserialize_with = "store::unique_map")]
    projects: BTreeMap<String, PathBuf>,
    active_phy: PathBuf,
    #[serde(default, deserialize_with = "store::unique_map")]
    session_projects: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RegistryError {
    Invalid(&'static str),
    Denied(&'static str),
    Conflict(&'static str),
    Unavailable(&'static str),
}

impl RegistryError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::Invalid(code)
            | Self::Denied(code)
            | Self::Conflict(code)
            | Self::Unavailable(code) => code,
        }
    }

    pub(crate) fn status(&self) -> &'static str {
        match self {
            Self::Invalid(_) => "invalid",
            Self::Denied(_) => "denied",
            Self::Conflict(_) => "conflict",
            Self::Unavailable(_) => "unavailable",
        }
    }

    pub(crate) fn retryable(&self) -> bool {
        matches!(
            self,
            Self::Unavailable("owner_unavailable" | "state_unavailable")
        )
    }
}

impl fmt::Display for RegistryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for RegistryError {}

#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct ProjectOwner {
    parent_id: OwnerId,
    rel_id: OwnerId,
}

#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Topology {
    version: u8,
    profile_id: String,
    principal_id: String,
    main_rel: OwnerId,
    active_phy: OwnerId,
    #[serde(deserialize_with = "store::unique_map")]
    projects: BTreeMap<String, ProjectOwner>,
}

#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct SessionRoute {
    session_id: String,
    project_id: Option<String>,
    rel_id: OwnerId,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct SessionBinding {
    pub(crate) session_id: String,
    pub(crate) rel_id: String,
    pub(crate) user_id: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct OwnerStatus {
    worker_state: &'static str,
    pending_jobs: usize,
}

pub(crate) struct Registry {
    admission: HostAdmissionAdapter,
    topology: Topology,
    session_projects: BTreeMap<String, String>,
    sessions_dir: PathBuf,
    // Release the process lease after the admission's owner mounts drop.
    _lease: File,
}

impl Registry {
    pub(crate) fn open(
        config: OwnerConfig,
        state_dir: &Path,
        token: &str,
    ) -> Result<Self, RegistryError> {
        config.validate()?;
        let state_dir = state_dir.canonicalize().map_err(|_| store::UNAVAILABLE)?;
        let lease = acquire_service_lease(&state_dir)?;
        let gateway = Gateway::new();
        let main = open_rel(&config.main_rel)?;
        if main.info().map_err(owner_error)?.scope == OwnerScope::Project {
            return Err(RegistryError::Invalid("main_rel_scope"));
        }
        let main_rel = main.owner_id();
        let mut rel_ids = BTreeSet::from([main_rel]);
        let mut rels = vec![main];
        let mut projects = BTreeMap::new();
        for (project_id, path) in config.projects {
            let rel = open_rel(&path)?;
            let rel_id = rel.owner_id();
            if rel.info().map_err(owner_error)?.scope != OwnerScope::Project {
                return Err(RegistryError::Invalid("project_rel_scope"));
            }
            if !rel_ids.insert(rel_id) {
                return Err(RegistryError::Invalid("duplicate_owner"));
            }
            projects.insert(
                project_id,
                ProjectOwner {
                    parent_id: main_rel,
                    rel_id,
                },
            );
            rels.push(rel);
        }
        let phy = Phylactery::open(owner_file(&config.active_phy)?).map_err(owner_error)?;
        let active_phy = phy.owner_id();
        if rel_ids.contains(&active_phy) {
            return Err(RegistryError::Invalid("duplicate_owner"));
        }
        let topology = Topology {
            version: 1,
            profile_id: config.profile_id,
            principal_id: config.principal_id,
            main_rel,
            active_phy,
            projects,
        };
        let topology_path = state_dir.join("topology-v1.json");
        let accepted: Option<Topology> = store::read(&topology_path, store::MAX_TOPOLOGY_BYTES)?;
        if accepted
            .as_ref()
            .is_some_and(|accepted| accepted != &topology)
        {
            return Err(RegistryError::Conflict("owner_topology_changed"));
        }
        for rel in rels {
            if gateway.mount_rel(&rel, true).map_err(owner_error)? != rel.owner_id() {
                return Err(RegistryError::Conflict("mounted_owner_changed"));
            }
        }
        if gateway.mount_phylactery(&phy, false).map_err(owner_error)? != active_phy {
            return Err(RegistryError::Conflict("mounted_owner_changed"));
        }
        let grants = rel_ids
            .into_iter()
            .map(OwnerGrant::OperateRel)
            .chain([OwnerGrant::ViewPhylactery(active_phy)]);
        let (admission, _) = TrustedHostAdmission::new([HostCredentialBinding::new(
            &topology.principal_id,
            token,
            grants,
        )])
        .install(&gateway)
        .map_err(owner_error)?;
        let sessions_dir = state_dir.join("sessions-v1");
        store::sessions_dir(&sessions_dir, accepted.is_some())?;
        if accepted.is_none() {
            store::publish(&topology_path, &topology)?;
        } else {
            store::sync_parent(&topology_path)?;
        }
        Ok(Self {
            admission,
            topology,
            session_projects: config.session_projects,
            sessions_dir,
            _lease: lease,
        })
    }

    pub(crate) fn profile_id(&self) -> &str {
        &self.topology.profile_id
    }

    pub(crate) fn principal_id(&self) -> &str {
        &self.topology.principal_id
    }

    pub(crate) fn authenticate(&self, token: &str) -> Result<Instance, RegistryError> {
        self.admission
            .authenticate(token)
            .map_err(|_| RegistryError::Denied("denied"))
    }

    pub(crate) fn bind_session(
        &mut self,
        session_id: &str,
    ) -> Result<SessionBinding, RegistryError> {
        let expected = self.route_for(session_id)?;
        let path = self.session_path(session_id);
        if self.accepted_route(&expected, &path)?.is_none() {
            store::publish(&path, &expected)?;
        } else {
            store::sync_parent(&path)?;
        }
        Ok(SessionBinding {
            session_id: expected.session_id,
            rel_id: expected.rel_id.to_string(),
            user_id: self.topology.active_phy.to_string(),
        })
    }

    pub(crate) fn is_bound(&self, session_id: &str) -> Result<bool, RegistryError> {
        let expected = self.route_for(session_id)?;
        Ok(self
            .accepted_route(&expected, &self.session_path(session_id))?
            .is_some())
    }

    pub(crate) fn source_owner(
        &self,
        session_id: &str,
        require_bound: bool,
    ) -> Result<OwnerId, RegistryError> {
        let route = self.route_for(session_id)?;
        let known = self.accepted_route(&route, &self.session_path(session_id))?;
        if require_bound && known.is_none() {
            return Err(RegistryError::Denied("unbound_session"));
        }
        Ok(route.rel_id)
    }

    pub(crate) fn owner_status(
        &self,
        instance: &Instance,
        session_id: &str,
    ) -> Result<OwnerStatus, RegistryError> {
        let route = self.route_for(session_id)?;
        if self
            .accepted_route(&route, &self.session_path(session_id))?
            .is_none()
        {
            return Err(RegistryError::Denied("unbound_session"));
        }
        let progress = instance
            .processing_status(route.rel_id, None)
            .map_err(owner_error)?;
        let worker_state = if progress.failed != 0 {
            "failed"
        } else if progress.held != 0 {
            "held"
        } else if progress.processing != 0 {
            "running"
        } else if progress.pending != 0 {
            "pending"
        } else {
            "complete"
        };
        if progress.pending > 10_000 {
            return Err(RegistryError::Unavailable("status_bound_exceeded"));
        }
        Ok(OwnerStatus {
            worker_state,
            pending_jobs: progress.pending,
        })
    }

    /// Build a read-only, private dashboard topology response from configured owners.
    pub(crate) fn dashboard_topology(
        &self,
        instance: &Instance,
        session_id: Option<&str>,
    ) -> Result<Value, RegistryError> {
        let mut owners = Vec::with_capacity(self.topology.projects.len() + 2);
        owners.push(owner_binding(
            instance,
            self.topology.main_rel,
            OwnerKind::Rel,
            "Main REL",
        )?);
        for (index, project) in self.topology.projects.values().enumerate() {
            owners.push(owner_binding(
                instance,
                project.rel_id,
                OwnerKind::Rel,
                &format!("Project {}", index + 1),
            )?);
        }
        owners.push(owner_binding(
            instance,
            self.topology.active_phy,
            OwnerKind::Phylactery,
            "Active user",
        )?);
        let (bound_session, session_owner_id) = match session_id {
            None => (None, None),
            Some(session) => {
                let route = self.route_for(session)?;
                let is_configured = self.session_projects.contains_key(session);
                let accepted = self
                    .accepted_route(&route, &self.session_path(session))?
                    .is_some();
                if !is_configured && !accepted {
                    return Err(RegistryError::Denied("unknown_session"));
                }
                (Some(session.to_owned()), Some(route.rel_id.to_string()))
            }
        };
        Ok(
            json!({"owners": owners, "active_phy_id": self.topology.active_phy.to_string(),
            "session_id": bound_session, "session_owner_id": session_owner_id}),
        )
    }

    fn route_for(&self, session_id: &str) -> Result<SessionRoute, RegistryError> {
        if !valid_id(session_id) {
            return Err(RegistryError::Invalid("invalid_session"));
        }
        let project_id = self.session_projects.get(session_id);
        let rel_id = project_id.map_or(self.topology.main_rel, |project| {
            self.topology.projects[project].rel_id
        });
        Ok(SessionRoute {
            session_id: session_id.to_owned(),
            project_id: project_id.cloned(),
            rel_id,
        })
    }

    fn session_path(&self, session_id: &str) -> PathBuf {
        let digest = Sha256::digest(session_id.as_bytes());
        self.sessions_dir.join(format!("{digest:x}.json"))
    }

    fn accepted_route(
        &self,
        expected: &SessionRoute,
        path: &Path,
    ) -> Result<Option<SessionRoute>, RegistryError> {
        let accepted: Option<SessionRoute> = store::read(path, store::MAX_SESSION_BYTES)?;
        if accepted
            .as_ref()
            .is_some_and(|accepted| accepted != expected)
        {
            return Err(RegistryError::Conflict("session_binding_changed"));
        }
        Ok(accepted)
    }
}

#[derive(Serialize)]
struct DashboardOwnerBinding {
    owner_id: String,
    owner_kind: &'static str,
    display_label: String,
    generation: String,
    cut: String,
    capabilities: DashboardCapabilities,
}

#[derive(Serialize)]
struct DashboardCapabilities {
    view: bool,
    manage: bool,
    history: bool,
    provenance: bool,
    graph: bool,
    community: bool,
    status: bool,
    memory_create: bool,
    memory_edit: bool,
    memory_retire: bool,
    relation_edit: bool,
    community_rename: bool,
}

fn owner_binding(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    label: &str,
) -> Result<DashboardOwnerBinding, RegistryError> {
    // Memory summaries expose the real accepted Root cut without reading body payloads.
    let page = instance
        .inspect_owner(
            owner,
            kind,
            &InspectionQuery::MemorySummaries(MemoryListFilters::default()),
            None,
            1,
        )
        .map_err(owner_error)?;
    let cut = page.cut;
    // The UI contract carries a decimal generation and opaque cut token. Preserve a
    // stable 128-bit generation projection; hash the complete Root cut so every
    // underlying generation/counter change changes the opaque cut token.
    let generation =
        u128::from_le_bytes(cut.generation[..16].try_into().expect("fixed generation"));
    let cut_digest = Sha256::digest(
        serde_json::to_vec(&cut).map_err(|_| RegistryError::Unavailable("owner_unavailable"))?,
    );
    Ok(DashboardOwnerBinding {
        owner_id: owner.to_string(),
        owner_kind: if kind == OwnerKind::Rel { "REL" } else { "PHY" },
        display_label: label.to_owned(),
        generation: generation.to_string(),
        cut: crate::service_http::hex(&cut_digest),
        capabilities: DashboardCapabilities {
            view: true,
            manage: false,
            history: false,
            provenance: false,
            graph: false,
            community: false,
            status: false,
            memory_create: false,
            memory_edit: false,
            memory_retire: false,
            relation_edit: false,
            community_rename: false,
        },
    })
}

impl OwnerConfig {
    fn validate(&self) -> Result<(), RegistryError> {
        if !valid_id(&self.profile_id)
            || !valid_id(&self.principal_id)
            || self.projects.len() > 128
            || self.session_projects.len() > 4096
            || !self.projects.keys().all(|project| valid_id(project))
            || !self
                .session_projects
                .iter()
                .all(|(session, project)| valid_id(session) && self.projects.contains_key(project))
        {
            return Err(RegistryError::Invalid("invalid_owner_config"));
        }
        Ok(())
    }
}

fn valid_id(value: &str) -> bool {
    let mut bytes = value.bytes();
    value.len() <= 128
        && bytes
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || b"_.:-".contains(&byte))
}

fn owner_file(path: &Path) -> Result<PathBuf, RegistryError> {
    if !path.is_absolute() {
        return Err(RegistryError::Invalid("invalid_owner_path"));
    }
    let path = path
        .canonicalize()
        .map_err(|_| RegistryError::Unavailable("owner_unavailable"))?;
    if !path.is_file() {
        return Err(RegistryError::Invalid("invalid_owner_path"));
    }
    Ok(path)
}

fn open_rel(path: &Path) -> Result<Rel, RegistryError> {
    Rel::open(owner_file(path)?).map_err(owner_error)
}

fn acquire_service_lease(state_dir: &Path) -> Result<File, RegistryError> {
    let path = state_dir.join("service.lock");
    match path.symlink_metadata() {
        Ok(metadata) if metadata.is_file() => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        _ => return Err(store::UNAVAILABLE),
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path).map_err(|_| store::UNAVAILABLE)?;
    match file.try_lock() {
        Ok(()) => Ok(file),
        Err(TryLockError::WouldBlock) => Err(RegistryError::Conflict("service_lease_conflict")),
        Err(TryLockError::Error(_)) => Err(store::UNAVAILABLE),
    }
}

fn owner_error(error: ProductError) -> RegistryError {
    match error.kind() {
        ProductErrorKind::Unauthorized | ProductErrorKind::Revoked => {
            RegistryError::Denied("denied")
        }
        ProductErrorKind::WriterUnavailable | ProductErrorKind::Conflict => {
            RegistryError::Conflict("owner_writer_conflict")
        }
        ProductErrorKind::WrongFormat | ProductErrorKind::InvalidInput => {
            RegistryError::Invalid("invalid_owner")
        }
        _ => RegistryError::Unavailable("owner_unavailable"),
    }
}
