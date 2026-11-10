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
pub(crate) mod registry_store;
use registry_store as store;

#[path = "setup_validation.rs"]
pub(crate) mod setup_validation;

#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;

const TOPOLOGY_FILE: &str = "topology-v1.json";

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
    dashboard_actor: Instance,
    dashboard_intents: PathBuf,
    topology: Topology,
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
        validate_rel_scope(main.info().map_err(owner_error)?.scope, false)?;
        let main_rel = main.owner_id();
        let mut rels = vec![main];
        let mut projects = BTreeMap::new();
        for (project_id, path) in &config.projects {
            let rel = open_rel(path)?;
            validate_rel_scope(rel.info().map_err(owner_error)?.scope, true)?;
            projects.insert(project_id.clone(), rel.owner_id());
            rels.push(rel);
        }
        let phy = Phylactery::open(owner_file(&config.active_phy)?).map_err(owner_error)?;
        let active_phy = phy.owner_id();
        let topology = config.topology(main_rel, active_phy, projects)?;
        let topology_path = state_dir.join(TOPOLOGY_FILE);
        let acceptance = topology.acceptance(&topology_path)?;
        let rel_ids = rels.iter().map(Rel::owner_id).collect::<Vec<_>>();
        for rel in rels {
            if gateway.mount_rel(&rel, true).map_err(owner_error)? != rel.owner_id() {
                return Err(RegistryError::Conflict("mounted_owner_changed"));
            }
        }
        if gateway.mount_phylactery(&phy, false).map_err(owner_error)? != active_phy {
            return Err(RegistryError::Conflict("mounted_owner_changed"));
        }
        // Derive a private Root actor using the existing bootstrap credential.
        // This separate in-process admission has no route or retained adapter.
        // Provider calls continue to use their original OperateRel instance.
        let (dashboard_admission, _) = TrustedHostAdmission::new([HostCredentialBinding::new(
            active_phy.to_string(),
            token,
            rel_ids.iter().copied().map(OwnerGrant::ManageRel),
        )])
        .install(&gateway)
        .map_err(owner_error)?;
        let dashboard_actor = dashboard_admission
            .authenticate(token)
            .map_err(owner_error)?;
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
        store::sessions_dir(&sessions_dir, acceptance != TopologyAcceptance::New)?;
        match acceptance {
            TopologyAcceptance::New => store::publish(&topology_path, &topology)?,
            TopologyAcceptance::Current => store::sync_parent(&topology_path)?,
            TopologyAcceptance::Extension => store::replace(&topology_path, &topology)?,
        }
        Ok(Self {
            admission,
            dashboard_actor,
            dashboard_intents: state_dir.join("dashboard-mutations-v1"),
            topology,
            sessions_dir,
            _lease: lease,
        })
    }

    pub(crate) fn dashboard_actor(&self) -> &Instance {
        &self.dashboard_actor
    }

    pub(crate) fn dashboard_intents(&self) -> &Path {
        &self.dashboard_intents
    }

    pub(crate) fn profile_id(&self) -> &str {
        &self.topology.profile_id
    }

    pub(crate) fn principal_id(&self) -> &str {
        &self.topology.principal_id
    }

    pub(crate) fn admission(&self) -> &HostAdmissionAdapter {
        &self.admission
    }

    pub(crate) fn authenticate(&self, token: &str) -> Result<Instance, RegistryError> {
        self.admission
            .authenticate(token)
            .map_err(|_| RegistryError::Denied("denied"))
    }

    pub(crate) fn bind_session(
        &mut self,
        session_id: &str,
        project_id: Option<&str>,
    ) -> Result<SessionBinding, RegistryError> {
        let path = self.session_path(session_id);
        let route = if let Some(route) = self.accepted_route(session_id)? {
            store::sync_parent(&path)?;
            route
        } else {
            if project_id.is_some_and(|project| !valid_id(project)) {
                return Err(RegistryError::Invalid("invalid_project"));
            }
            let rel_id = project_id
                .and_then(|project| self.topology.projects.get(project))
                .map_or(self.topology.main_rel, |project| project.rel_id);
            let route = SessionRoute {
                session_id: session_id.to_owned(),
                project_id: project_id.map(str::to_owned),
                rel_id,
            };
            store::publish(&path, &route)?;
            route
        };
        Ok(SessionBinding {
            session_id: route.session_id,
            rel_id: route.rel_id.to_string(),
            user_id: self.topology.active_phy.to_string(),
        })
    }

    pub(crate) fn is_bound(&self, session_id: &str) -> Result<bool, RegistryError> {
        Ok(self.accepted_route(session_id)?.is_some())
    }

    pub(crate) fn source_owner(
        &self,
        session_id: &str,
        require_bound: bool,
    ) -> Result<OwnerId, RegistryError> {
        match self.accepted_route(session_id)? {
            Some(route) => Ok(route.rel_id),
            None if !require_bound => Ok(self.topology.main_rel),
            None => Err(RegistryError::Denied("unbound_session")),
        }
    }

    pub(crate) fn configured_source_owner(&self, owner_id: &str) -> Result<OwnerId, RegistryError> {
        let owner = owner_id
            .parse::<OwnerId>()
            .map_err(|_| RegistryError::Invalid("invalid_owner"))?;
        if owner == self.topology.main_rel
            || self
                .topology
                .projects
                .values()
                .any(|project| project.rel_id == owner)
        {
            Ok(owner)
        } else {
            Err(RegistryError::Denied("unconfigured_source_owner"))
        }
    }

    pub(crate) fn owner_status(
        &self,
        instance: &Instance,
        session_id: &str,
    ) -> Result<OwnerStatus, RegistryError> {
        let rel_id = self.source_owner(session_id, true)?;
        let progress = instance
            .processing_status(rel_id, None)
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
                let route = self
                    .accepted_route(session)?
                    .ok_or(RegistryError::Denied("unknown_session"))?;
                (Some(session.to_owned()), Some(route.rel_id.to_string()))
            }
        };
        Ok(
            json!({"owners": owners, "active_phy_id": self.topology.active_phy.to_string(),
            "session_id": bound_session, "session_owner_id": session_owner_id}),
        )
    }

    pub(crate) fn dashboard_scope(
        &self,
        profile_id: &str,
        principal_id: &str,
        owner_id: &str,
        session_id: Option<&str>,
    ) -> Result<(OwnerId, OwnerKind, String), RegistryError> {
        if profile_id != self.topology.profile_id
            || principal_id != self.topology.active_phy.to_string()
        {
            return Err(RegistryError::Denied("owner_denied"));
        }
        let owner: OwnerId = owner_id
            .parse()
            .map_err(|_| RegistryError::Denied("owner_denied"))?;
        let (kind, label) = if owner == self.topology.main_rel {
            (OwnerKind::Rel, "Main REL".to_owned())
        } else if owner == self.topology.active_phy {
            (OwnerKind::Phylactery, "Active user".to_owned())
        } else if let Some(index) = self
            .topology
            .projects
            .values()
            .position(|project| project.rel_id == owner)
        {
            (OwnerKind::Rel, format!("Project {}", index + 1))
        } else {
            return Err(RegistryError::Denied("owner_denied"));
        };
        if let Some(session) = session_id {
            if kind != OwnerKind::Rel
                || !self
                    .accepted_route(session)?
                    .is_some_and(|route| route.rel_id == owner)
            {
                return Err(RegistryError::Denied("unknown_session"));
            }
        }
        Ok((owner, kind, label))
    }

    fn session_path(&self, session_id: &str) -> PathBuf {
        let digest = Sha256::digest(session_id.as_bytes());
        self.sessions_dir.join(format!("{digest:x}.json"))
    }

    fn accepted_route(&self, session_id: &str) -> Result<Option<SessionRoute>, RegistryError> {
        if !valid_id(session_id) {
            return Err(RegistryError::Invalid("invalid_session"));
        }
        let path = self.session_path(session_id);
        let accepted: Option<SessionRoute> = store::read(&path, store::MAX_SESSION_BYTES)?;
        if let Some(route) = &accepted {
            let project = route.project_id.as_deref();
            let dedicated = project
                .and_then(|project| self.topology.projects.get(project))
                .is_some_and(|owner| owner.rel_id == route.rel_id);
            if route.session_id != session_id
                || project.is_some_and(|project| !valid_id(project))
                || (!dedicated && route.rel_id != self.topology.main_rel)
            {
                return Err(RegistryError::Unavailable("state_corrupt"));
            }
        }
        Ok(accepted)
    }
}

#[derive(Serialize)]
pub(crate) struct DashboardOwnerBinding {
    owner_id: String,
    owner_kind: &'static str,
    display_label: String,
    pub(crate) generation: String,
    pub(crate) cut: String,
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

pub(crate) fn owner_binding(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    label: &str,
) -> Result<DashboardOwnerBinding, RegistryError> {
    let cut = inspect_dashboard_cut(instance, owner, kind)?;
    Ok(dashboard_binding_at_cut(owner, kind, label, &cut))
}

pub(crate) fn inspect_dashboard_cut(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
) -> Result<reliquary_memory::InspectionCut, RegistryError> {
    // A one-row summary query obtains the accepted Root cut without releasing bodies.
    instance
        .inspect_owner(
            owner,
            kind,
            &InspectionQuery::MemorySummaries(MemoryListFilters::default()),
            None,
            1,
        )
        .map(|page| page.cut)
        .map_err(owner_error)
}

pub(crate) fn dashboard_binding_at_cut(
    owner: OwnerId,
    kind: OwnerKind,
    label: &str,
    cut: &reliquary_memory::InspectionCut,
) -> DashboardOwnerBinding {
    DashboardOwnerBinding {
        owner_id: owner.to_string(),
        owner_kind: if kind == OwnerKind::Rel { "REL" } else { "PHY" },
        display_label: label.to_owned(),
        generation: crate::dashboard::generation_id(cut),
        cut: crate::dashboard::cut_id(cut),
        capabilities: DashboardCapabilities {
            view: true,
            manage: kind == OwnerKind::Rel,
            history: true,
            provenance: true,
            graph: true,
            community: kind == OwnerKind::Rel,
            status: kind == OwnerKind::Rel,
            memory_create: kind == OwnerKind::Rel,
            memory_edit: kind == OwnerKind::Rel,
            memory_retire: kind == OwnerKind::Rel,
            relation_edit: kind == OwnerKind::Rel,
            community_rename: kind == OwnerKind::Rel,
        },
    }
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

    fn topology(
        &self,
        main_rel: OwnerId,
        active_phy: OwnerId,
        projects: BTreeMap<String, OwnerId>,
    ) -> Result<Topology, RegistryError> {
        let mut ids = BTreeSet::from([main_rel]);
        if !ids.insert(active_phy) || !projects.values().all(|id| ids.insert(*id)) {
            return Err(RegistryError::Invalid("duplicate_owner"));
        }
        let projects = projects
            .into_iter()
            .map(|(project, rel_id)| {
                (
                    project,
                    ProjectOwner {
                        parent_id: main_rel,
                        rel_id,
                    },
                )
            })
            .collect();
        Ok(Topology {
            version: 1,
            profile_id: self.profile_id.clone(),
            principal_id: self.principal_id.clone(),
            main_rel,
            active_phy,
            projects,
        })
    }
}

#[derive(PartialEq, Eq)]
enum TopologyAcceptance {
    New,
    Current,
    Extension,
}

impl Topology {
    fn acceptance(&self, path: &Path) -> Result<TopologyAcceptance, RegistryError> {
        let Some(accepted) = store::read::<Self>(path, store::MAX_TOPOLOGY_BYTES)? else {
            return Ok(TopologyAcceptance::New);
        };
        if accepted == *self {
            return Ok(TopologyAcceptance::Current);
        }
        if accepted.version == self.version
            && accepted.profile_id == self.profile_id
            && accepted.principal_id == self.principal_id
            && accepted.main_rel == self.main_rel
            && accepted.active_phy == self.active_phy
            && accepted
                .projects
                .iter()
                .all(|(id, owner)| self.projects.get(id) == Some(owner))
        {
            return Ok(TopologyAcceptance::Extension);
        }
        Err(RegistryError::Conflict("owner_topology_changed"))
    }
}

fn validate_rel_scope(scope: OwnerScope, project: bool) -> Result<(), RegistryError> {
    match (scope == OwnerScope::Project, project) {
        (true, false) => Err(RegistryError::Invalid("main_rel_scope")),
        (false, true) => Err(RegistryError::Invalid("project_rel_scope")),
        _ => Ok(()),
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
