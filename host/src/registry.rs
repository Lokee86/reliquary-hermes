//! Service-owned owner topology and durable Hermes session binding.
use reliquary_memory::{
    ConfiguredRuntime, Gateway, HostAdmissionAdapter, HostAdmissionControl, HostCredentialBinding,
    InspectionQuery, Instance, MemoryListFilters, OwnerGrant, OwnerId, OwnerKind, Phylactery,
    ProductError, ProductErrorKind, Rel, TrustedHostAdmission,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    fs::{File, OpenOptions, TryLockError},
    path::{Path, PathBuf},
    sync::Arc,
};

#[path = "registry_store.rs"]
pub(crate) mod registry_store;
use registry_store as store;

#[path = "registry_topology.rs"]
mod topology;
pub(crate) use topology::{SwitchChanges, SwitchReview, SwitchStatus, committed_switch_status};

#[path = "registry_switch.rs"]
mod switch;

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

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct ProjectOwner {
    parent_id: OwnerId,
    rel_id: OwnerId,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct LegacyTopology {
    version: u8,
    profile_id: String,
    principal_id: String,
    main_rel: OwnerId,
    active_phy: OwnerId,
    #[serde(deserialize_with = "store::unique_map")]
    projects: BTreeMap<String, ProjectOwner>,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Topology {
    version: u8,
    generation: u64,
    profile_id: String,
    principal_id: String,
    main_rel: OwnerId,
    active_phy: OwnerId,
    #[serde(deserialize_with = "store::unique_map")]
    projects: BTreeMap<String, ProjectOwner>,
    #[serde(deserialize_with = "store::unique_map")]
    owners: BTreeMap<OwnerId, RegisteredOwner>,
    legacy: LegacyTopology,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct RegisteredOwner {
    path: PathBuf,
    kind: OwnerKind,
    general: bool,
    projects: BTreeSet<String>,
}

#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct SessionRoute {
    session_id: String,
    project_id: Option<String>,
    rel_id: OwnerId,
    #[serde(default)]
    phy_id: Option<OwnerId>,
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
    gateway: Gateway,
    perception_runtime: Option<(u64, Arc<ConfiguredRuntime>)>,
    phy_perception_worker: Option<reliquary_memory::PhyPerceptionWorker>,
    phy_perception_enabled: bool,
    active_phy_recall: reliquary_memory::ActivePhyRecall,
    ego_runtime: Option<(u64, Arc<ConfiguredRuntime>)>,
    ego_worker: Option<reliquary_memory::EgoWorkerHandle>,
    ego_enabled: bool,
    pub(crate) ego_approval: Option<crate::ego::IdentityApproval>,
    admissions: Admissions,
    credential: String,
    dashboard_intents: PathBuf,
    topology: Topology,
    topology_path: PathBuf,
    mounted_rels: BTreeSet<OwnerId>,
    sessions_dir: PathBuf,
    fenced: bool,
    // Release the process lease after the admission's owner mounts drop.
    _lease: File,
}

struct Admissions {
    provider: HostAdmissionAdapter,
    provider_instance: Instance,
    provider_control: HostAdmissionControl,
    dashboard_actor: Instance,
    dashboard_control: HostAdmissionControl,
    phy_actor: Option<(Instance, HostAdmissionControl)>,
}

impl Registry {
    pub(crate) fn open(
        config: OwnerConfig,
        state_dir: &Path,
        token: &str,
    ) -> Result<Self, RegistryError> {
        let ego_enabled =
            std::env::var_os("RELIQUARY_HERMES_EGO").is_some_and(|value| value == "1");
        let phy_perception_enabled =
            std::env::var_os("RELIQUARY_HERMES_PHY_PERCEPTION").is_some_and(|value| value == "1");
        Self::open_with_features(
            config,
            state_dir,
            token,
            ego_enabled,
            phy_perception_enabled,
        )
    }

    #[cfg(test)]
    fn open_with_ego(
        config: OwnerConfig,
        state_dir: &Path,
        token: &str,
        ego_enabled: bool,
    ) -> Result<Self, RegistryError> {
        Self::open_with_features(config, state_dir, token, ego_enabled, false)
    }

    fn open_with_features(
        config: OwnerConfig,
        state_dir: &Path,
        token: &str,
        ego_enabled: bool,
        phy_perception_enabled: bool,
    ) -> Result<Self, RegistryError> {
        let writable_phy = ego_enabled || phy_perception_enabled;
        config.validate()?;
        let state_dir = state_dir.canonicalize().map_err(|_| store::UNAVAILABLE)?;
        let lease = acquire_service_lease(&state_dir)?;
        let topology_path = state_dir.join(TOPOLOGY_FILE);
        let gateway = Gateway::new();
        let (topology, write) =
            topology::prepare_startup(&config, &topology_path, &gateway, writable_phy)?;
        let sessions_dir = state_dir.join("sessions-v1");
        store::sessions_dir(&sessions_dir, write != topology::StartupWrite::Create)?;
        let mounted_rels = match write {
            topology::StartupWrite::Current => {
                switch::mount_on_startup(&gateway, &topology, writable_phy)?
            }
            topology::StartupWrite::Create | topology::StartupWrite::Upgrade => topology
                .owners
                .iter()
                .filter_map(|(&id, owner)| (owner.kind == OwnerKind::Rel).then_some(id))
                .collect(),
        };
        let admissions = Admissions::new(&gateway, &topology, &mounted_rels, token, writable_phy)?;
        topology::publish_startup(&topology_path, &topology, write)?;
        Ok(Self {
            gateway,
            perception_runtime: None,
            phy_perception_worker: None,
            phy_perception_enabled,
            active_phy_recall: reliquary_memory::ActivePhyRecall::new(topology.active_phy),
            ego_runtime: None,
            ego_worker: None,
            ego_approval: None,
            ego_enabled,
            admissions,
            credential: token.to_owned(),
            dashboard_intents: state_dir.join("dashboard-mutations-v1"),
            topology,
            topology_path,
            mounted_rels,
            sessions_dir,
            fenced: false,
            _lease: lease,
        })
    }

    pub(crate) fn set_perception_runtime(
        &mut self,
        runtime: Option<(u64, Arc<ConfiguredRuntime>)>,
    ) -> Result<(), RegistryError> {
        self.require_current()?;
        if self.perception_runtime.as_ref().map(|(epoch, _)| *epoch)
            != runtime.as_ref().map(|(epoch, _)| *epoch)
        {
            self.phy_perception_worker.take();
            self.gateway
                .set_perception_runtime(runtime.as_ref().map(|(_, runtime)| runtime.as_ref()))
                .map_err(owner_error)?;
            self.perception_runtime = runtime;
        }
        self.resume_phy_perception()?;
        Ok(())
    }

    fn writable_phy(&self) -> bool {
        self.ego_enabled || self.phy_perception_enabled
    }

    fn resume_phy_perception(&mut self) -> Result<(), RegistryError> {
        if !self.phy_perception_enabled
            || self.perception_runtime.is_none()
            || self.phy_perception_worker.is_some()
        {
            return Ok(());
        }
        let (actor, _) = self
            .admissions
            .phy_actor
            .as_ref()
            .ok_or(store::UNAVAILABLE)?;
        self.phy_perception_worker = Some(
            actor
                .start_phy_perception(self.active_phy())
                .map_err(owner_error)?,
        );
        Ok(())
    }

    pub(crate) fn set_ego_runtime(
        &mut self,
        runtime: Option<(u64, Arc<ConfiguredRuntime>)>,
    ) -> Result<(), RegistryError> {
        self.require_current()?;
        if self.ego_runtime.as_ref().map(|(epoch, _)| *epoch)
            != runtime.as_ref().map(|(epoch, _)| *epoch)
        {
            self.ego_worker.take();
            self.ego_runtime = runtime;
        }
        if self.ego_worker.is_none() {
            self.resume_ego_worker();
        }
        Ok(())
    }

    fn resume_ego_worker(&mut self) {
        if self.restart_ego_worker().is_err() {
            eprintln!("reliquary-hermes-host: ego_worker_unavailable");
        }
    }

    fn restart_ego_worker(&mut self) -> Result<(), RegistryError> {
        if !self.ego_enabled {
            return Ok(());
        }
        let Some((_, runtime)) = &self.ego_runtime else {
            return Ok(());
        };
        let Some((actor, _)) = &self.admissions.phy_actor else {
            return Ok(());
        };
        let sources = self
            .mounted_rels
            .iter()
            .copied()
            .filter(|id| self.topology.current_rel(*id))
            .collect::<Vec<_>>();
        self.ego_worker = Some(
            actor
                .start_ego_worker(
                    self.active_phy(),
                    &sources,
                    self.topology_path.parent().ok_or(store::UNAVAILABLE)?,
                    runtime,
                    |text| text.len() as u64,
                )
                .map_err(owner_error)?,
        );
        Ok(())
    }

    pub(crate) fn ego_actor(&self) -> Result<&Instance, RegistryError> {
        self.require_current()?;
        if !self.ego_enabled {
            return Err(RegistryError::Denied("ego_disabled"));
        }
        self.admissions
            .phy_actor
            .as_ref()
            .map(|(actor, _)| actor)
            .ok_or(RegistryError::Denied("ego_profile_not_enabled"))
    }

    pub(crate) fn dashboard_actor(&self) -> &Instance {
        &self.admissions.dashboard_actor
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
        &self.admissions.provider
    }

    pub(crate) fn authenticate(&self, token: &str) -> Result<Instance, RegistryError> {
        self.require_current()?;
        self.admission()
            .authenticate(token)
            .map_err(|_| RegistryError::Denied("denied"))
    }

    pub(crate) fn instance(&self) -> Result<Instance, RegistryError> {
        self.require_current()?;
        Ok(self.admissions.provider_instance.clone())
    }

    pub(crate) fn active_phy(&self) -> OwnerId {
        self.topology.active_phy
    }

    pub(crate) fn active_phy_recall(&self) -> reliquary_memory::ActivePhyRecall {
        self.active_phy_recall.clone()
    }

    pub(crate) fn legacy_phy(&self) -> OwnerId {
        self.topology.legacy.active_phy
    }

    fn require_current(&self) -> Result<(), RegistryError> {
        if self.fenced {
            return Err(RegistryError::Unavailable("owner_switch_recovery_required"));
        }
        Ok(())
    }

    fn fence(&mut self) {
        self.fenced = true;
        self.active_phy_recall.invalidate();
        self.phy_perception_worker.take();
        self.ego_worker.take();
        self.ego_runtime.take();
        self.ego_approval.take();
        if self.perception_runtime.take().is_some() {
            let _ = self.gateway.set_perception_runtime(None);
        }
        let _ = self.admissions.revoke(&self.credential);
    }

    pub(crate) fn bind_session(
        &mut self,
        session_id: &str,
        project_id: Option<&str>,
    ) -> Result<SessionBinding, RegistryError> {
        let path = self.session_path(session_id);
        let route = if let Some(route) = self.accepted_route(session_id)? {
            self.require_route_available(&route)?;
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
                phy_id: Some(self.active_phy()),
            };
            self.require_route_available(&route)?;
            store::publish(&path, &route)?;
            route
        };
        let user_id = route.phy_id.unwrap_or(self.legacy_phy()).to_string();
        Ok(SessionBinding {
            session_id: route.session_id,
            rel_id: route.rel_id.to_string(),
            user_id,
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
            Some(route) => {
                self.require_route_available(&route)?;
                Ok(route.rel_id)
            }
            None if !require_bound => Ok(self.topology.main_rel),
            None => Err(RegistryError::Denied("unbound_session")),
        }
    }

    pub(crate) fn configured_source_owner(&self, owner_id: &str) -> Result<OwnerId, RegistryError> {
        self.require_current()?;
        let owner = parse_source_owner(owner_id)?;
        if self.topology.current_rel(owner) {
            Ok(owner)
        } else {
            Err(RegistryError::Denied("unconfigured_source_owner"))
        }
    }

    pub(crate) fn legacy_source_owner(&self, owner_id: &str) -> Result<OwnerId, RegistryError> {
        let owner = self.retained_source_owner(owner_id)?;
        if self.topology.current_rel(owner)
            || self.topology.legacy.main_rel == owner
            || self
                .topology
                .legacy
                .projects
                .values()
                .any(|project| project.rel_id == owner)
        {
            Ok(owner)
        } else {
            Err(RegistryError::Denied("unconfigured_source_owner"))
        }
    }

    pub(crate) fn retained_source_owner(&self, owner_id: &str) -> Result<OwnerId, RegistryError> {
        self.require_current()?;
        let owner = parse_source_owner(owner_id)?;
        if self.mounted_rels.contains(&owner) {
            Ok(owner)
        } else if self.topology.has_rel(owner) {
            Err(RegistryError::Unavailable("bound_owner_unavailable"))
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

    /// Build a read-only topology response for this profile and optional session.
    pub(crate) fn dashboard_topology(
        &self,
        instance: &Instance,
        session_id: Option<&str>,
    ) -> Result<Value, RegistryError> {
        self.require_current()?;
        let session_owner = self.dashboard_session_owner(session_id)?;
        let mut owners = Vec::with_capacity(self.topology.projects.len() + 3);
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
        if let Some(owner) = session_owner
            && !self.topology.current_rel(owner)
        {
            owners.push(owner_binding(
                instance,
                owner,
                OwnerKind::Rel,
                "Session REL",
            )?);
        }
        owners.push(owner_binding(
            instance,
            self.active_phy(),
            OwnerKind::Phylactery,
            "Active user",
        )?);
        Ok(json!({
            "owners": owners,
            "active_phy_id": self.active_phy(),
            "session_id": session_id,
            "session_owner_id": session_owner,
        }))
    }

    pub(crate) fn dashboard_scope(
        &self,
        profile_id: &str,
        principal_id: &str,
        owner_id: &str,
        session_id: Option<&str>,
    ) -> Result<(OwnerId, OwnerKind, String), RegistryError> {
        self.require_current()?;
        let denied = RegistryError::Denied("owner_denied");
        if profile_id != self.topology.profile_id || principal_id != self.active_phy().to_string() {
            return Err(denied);
        }
        let owner = owner_id.parse::<OwnerId>().map_err(|_| denied.clone())?;
        let session_owner = self.dashboard_session_owner(session_id)?;
        let (kind, label) = if owner == self.topology.main_rel {
            (OwnerKind::Rel, "Main REL".to_owned())
        } else if owner == self.active_phy() {
            (OwnerKind::Phylactery, "Active user".to_owned())
        } else if let Some(index) = self
            .topology
            .projects
            .values()
            .position(|project| project.rel_id == owner)
        {
            (OwnerKind::Rel, format!("Project {}", index + 1))
        } else if session_owner == Some(owner) {
            (OwnerKind::Rel, "Session REL".to_owned())
        } else {
            return Err(denied);
        };
        if let Some(bound_owner) = session_owner
            && (kind != OwnerKind::Rel || bound_owner != owner)
        {
            return Err(RegistryError::Denied("unknown_session"));
        }
        Ok((owner, kind, label))
    }

    fn dashboard_session_owner(
        &self,
        session_id: Option<&str>,
    ) -> Result<Option<OwnerId>, RegistryError> {
        let Some(session_id) = session_id else {
            return Ok(None);
        };
        let route = self
            .accepted_route(session_id)?
            .ok_or(RegistryError::Denied("unknown_session"))?;
        self.require_route_available(&route)?;
        Ok(Some(route.rel_id))
    }

    fn require_route_available(&self, route: &SessionRoute) -> Result<(), RegistryError> {
        if route.phy_id.unwrap_or(self.legacy_phy()) != self.active_phy() {
            return Err(RegistryError::Unavailable("session_phy_inactive"));
        }
        if !self.mounted_rels.contains(&route.rel_id) {
            return Err(RegistryError::Unavailable("bound_owner_unavailable"));
        }
        Ok(())
    }

    fn session_path(&self, session_id: &str) -> PathBuf {
        let digest = Sha256::digest(session_id.as_bytes());
        self.sessions_dir.join(format!("{digest:x}.json"))
    }

    fn accepted_route(&self, session_id: &str) -> Result<Option<SessionRoute>, RegistryError> {
        self.require_current()?;
        if !valid_id(session_id) {
            return Err(RegistryError::Invalid("invalid_session"));
        }
        let accepted: Option<SessionRoute> =
            store::read(&self.session_path(session_id), store::MAX_SESSION_BYTES)?;
        if let Some(route) = &accepted
            && (route.session_id != session_id
                || route
                    .project_id
                    .as_ref()
                    .is_some_and(|project| !valid_id(project))
                || !self.topology.accepts_route(route))
        {
            return Err(store::CORRUPT);
        }
        Ok(accepted)
    }
}

fn parse_source_owner(owner_id: &str) -> Result<OwnerId, RegistryError> {
    owner_id
        .parse()
        .map_err(|_| RegistryError::Invalid("invalid_owner"))
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

pub(crate) fn owner_error(error: ProductError) -> RegistryError {
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
