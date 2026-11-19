//! Profile assignments, persisted topology compatibility and Setup wire values.
use super::{
    LegacyTopology, OwnerConfig, OwnerId, OwnerKind, ProjectOwner, RegisteredOwner, RegistryError,
    SessionRoute, TOPOLOGY_FILE, Topology, owner_error, owner_file, store, valid_id,
};
use crate::service_http::MAX_WIRE_BYTES;
use reliquary_memory::{Phylactery, ProductErrorKind, Rel};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

const MAX_PROJECTS: usize = 128;
const TOPOLOGY_CHANGED: RegistryError = RegistryError::Conflict("owner_topology_changed");

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, bound(deserialize = "T: Deserialize<'de>"))]
pub(crate) struct SwitchChanges<T> {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) main_rel: Option<T>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) active_phy: Option<T>,
    #[serde(default, deserialize_with = "store::unique_map")]
    pub(super) projects: BTreeMap<String, T>,
}

impl<T> SwitchChanges<T> {
    pub(super) fn verify_project_ids(&self) -> Result<(), RegistryError> {
        if self.projects.len() > MAX_PROJECTS || !self.projects.keys().all(|id| valid_id(id)) {
            return Err(RegistryError::Invalid("invalid_project"));
        }
        Ok(())
    }

    pub(super) fn map<U>(
        self,
        mut verify: impl FnMut(T, OwnerKind) -> Result<U, RegistryError>,
    ) -> Result<SwitchChanges<U>, RegistryError> {
        Ok(SwitchChanges {
            main_rel: self
                .main_rel
                .map(|item| verify(item, OwnerKind::Rel))
                .transpose()?,
            active_phy: self
                .active_phy
                .map(|item| verify(item, OwnerKind::Phylactery))
                .transpose()?,
            projects: self
                .projects
                .into_iter()
                .map(|(id, item)| Ok((id, verify(item, OwnerKind::Rel)?)))
                .collect::<Result<_, RegistryError>>()?,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct ReviewedOwner {
    pub(super) path: PathBuf,
    pub(super) owner_id: OwnerId,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SwitchReview {
    pub(super) generation: u64,
    pub(super) changes: SwitchChanges<ReviewedOwner>,
}

#[derive(Debug, Serialize)]
struct CurrentOwners {
    main_rel: ReviewedOwner,
    active_phy: ReviewedOwner,
    projects: BTreeMap<String, ReviewedOwner>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SwitchStatus {
    pub(crate) generation: u64,
    owners: CurrentOwners,
    legacy_phy_id: OwnerId,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum PersistedTopology {
    Current(Topology),
    Legacy(LegacyTopology),
}

#[derive(PartialEq, Eq)]
pub(super) enum StartupWrite {
    Create,
    Upgrade,
    Current,
}

fn load(path: &Path) -> Result<Option<PersistedTopology>, RegistryError> {
    let accepted = store::read(path, store::MAX_TOPOLOGY_BYTES)?;
    match accepted.as_ref() {
        Some(PersistedTopology::Current(topology)) => topology.validate()?,
        Some(PersistedTopology::Legacy(topology)) => topology.validate()?,
        None => {}
    }
    Ok(accepted)
}

pub(crate) fn committed_switch_status(
    state_dir: &Path,
) -> Result<Option<SwitchStatus>, RegistryError> {
    if !state_dir.is_absolute() {
        return Err(RegistryError::Invalid("invalid_state_directory"));
    }
    match load(&state_dir.join(TOPOLOGY_FILE))? {
        Some(PersistedTopology::Current(topology)) => Ok(Some(topology.status())),
        _ => Ok(None),
    }
}

pub(super) fn load_for_startup(
    config: &OwnerConfig,
    path: &Path,
) -> Result<(Topology, StartupWrite), RegistryError> {
    let accepted = load(path)?;
    if let Some(PersistedTopology::Current(topology)) = accepted {
        if topology.profile_id != config.profile_id || topology.principal_id != config.principal_id
        {
            return Err(TOPOLOGY_CHANGED);
        }
        return Ok((topology, StartupWrite::Current));
    }

    let changes = SwitchChanges {
        main_rel: Some(verify_bootstrap_path(&config.main_rel, OwnerKind::Rel)?),
        active_phy: Some(verify_bootstrap_path(
            &config.active_phy,
            OwnerKind::Phylactery,
        )?),
        projects: config
            .projects
            .iter()
            .map(|(id, path)| Ok((id.clone(), verify_bootstrap_path(path, OwnerKind::Rel)?)))
            .collect::<Result<_, RegistryError>>()?,
    };
    let main = changes
        .main_rel
        .as_ref()
        .expect("bootstrap specifies main REL");
    let phy = changes
        .active_phy
        .as_ref()
        .expect("bootstrap specifies active PHY");
    let bootstrap = config.legacy_topology(
        main.owner_id,
        phy.owner_id,
        changes
            .projects
            .iter()
            .map(|(id, project)| (id.clone(), project.owner_id))
            .collect(),
    )?;
    let (legacy, write) = match accepted {
        Some(PersistedTopology::Legacy(legacy)) => {
            legacy.allow_bootstrap(&bootstrap)?;
            (legacy, StartupWrite::Upgrade)
        }
        None => (bootstrap.clone(), StartupWrite::Create),
        Some(PersistedTopology::Current(_)) => unreachable!(),
    };
    let mut topology = Topology {
        version: 2,
        generation: 0,
        profile_id: bootstrap.profile_id,
        principal_id: bootstrap.principal_id,
        main_rel: bootstrap.main_rel,
        active_phy: bootstrap.active_phy,
        projects: bootstrap.projects,
        owners: BTreeMap::new(),
        legacy,
    };
    topology.record_assignments(&changes)?;
    topology.check_size()?;
    Ok((topology, write))
}

pub(super) fn publish_startup(
    path: &Path,
    topology: &Topology,
    write: StartupWrite,
) -> Result<(), RegistryError> {
    match write {
        StartupWrite::Create => store::publish(path, topology),
        StartupWrite::Upgrade => store::replace(path, topology),
        StartupWrite::Current => store::sync_parent(path),
    }
}

/// The legacy preflight remains read-only. On v2 it may verify the committed
/// choices, while changes must go through signed Review and Apply.
pub(super) fn check_setup_topology(
    config: &OwnerConfig,
    main: OwnerId,
    phy: OwnerId,
    projects: BTreeMap<String, OwnerId>,
    path: &Path,
) -> Result<(), RegistryError> {
    let candidate = config.legacy_topology(main, phy, projects)?;
    match load(path)? {
        None => Ok(()),
        Some(PersistedTopology::Legacy(legacy)) => legacy.allow_bootstrap(&candidate),
        Some(PersistedTopology::Current(current)) => {
            if current.profile_id != candidate.profile_id
                || current.principal_id != candidate.principal_id
                || current.main_rel != candidate.main_rel
                || current.active_phy != candidate.active_phy
                || current.projects != candidate.projects
                || current.owners[&main].path != owner_file(&config.main_rel)?
                || current.owners[&phy].path != owner_file(&config.active_phy)?
            {
                return Err(TOPOLOGY_CHANGED);
            }
            for (id, project) in &current.projects {
                if current.owners[&project.rel_id].path != owner_file(&config.projects[id])? {
                    return Err(TOPOLOGY_CHANGED);
                }
            }
            Ok(())
        }
    }
}

impl OwnerConfig {
    pub(super) fn validate(&self) -> Result<(), RegistryError> {
        if !valid_id(&self.profile_id)
            || !valid_id(&self.principal_id)
            || self.projects.len() > MAX_PROJECTS
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

    fn legacy_topology(
        &self,
        main_rel: OwnerId,
        active_phy: OwnerId,
        projects: BTreeMap<String, OwnerId>,
    ) -> Result<LegacyTopology, RegistryError> {
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
        check_unique_roles(main_rel, active_phy, &projects)?;
        Ok(LegacyTopology {
            version: 1,
            profile_id: self.profile_id.clone(),
            principal_id: self.principal_id.clone(),
            main_rel,
            active_phy,
            projects,
        })
    }
}

impl LegacyTopology {
    fn validate(&self) -> Result<(), RegistryError> {
        if self.version != 1
            || !valid_id(&self.profile_id)
            || !valid_id(&self.principal_id)
            || !valid_projects(self.main_rel, &self.projects)
        {
            return Err(store::CORRUPT);
        }
        check_unique_roles(self.main_rel, self.active_phy, &self.projects)
            .map_err(|_| store::CORRUPT)
    }

    fn allow_bootstrap(&self, candidate: &Self) -> Result<(), RegistryError> {
        if self.profile_id != candidate.profile_id
            || self.principal_id != candidate.principal_id
            || self.main_rel != candidate.main_rel
            || self.active_phy != candidate.active_phy
            || !self
                .projects
                .iter()
                .all(|(id, owner)| candidate.projects.get(id) == Some(owner))
        {
            return Err(TOPOLOGY_CHANGED);
        }
        Ok(())
    }
}

impl Topology {
    pub(super) fn status(&self) -> SwitchStatus {
        let reviewed = |id| ReviewedOwner {
            owner_id: id,
            path: self.owners[&id].path.clone(),
        };
        SwitchStatus {
            generation: self.generation,
            owners: CurrentOwners {
                main_rel: reviewed(self.main_rel),
                active_phy: reviewed(self.active_phy),
                projects: self
                    .projects
                    .iter()
                    .map(|(id, project)| (id.clone(), reviewed(project.rel_id)))
                    .collect(),
            },
            legacy_phy_id: self.legacy.active_phy,
        }
    }

    pub(super) fn current_rel(&self, owner: OwnerId) -> bool {
        owner == self.main_rel
            || self
                .projects
                .values()
                .any(|project| project.rel_id == owner)
    }

    pub(super) fn has_rel(&self, owner: OwnerId) -> bool {
        self.owners
            .get(&owner)
            .is_some_and(|entry| entry.kind == OwnerKind::Rel)
    }

    pub(super) fn accepts_route(&self, route: &SessionRoute) -> bool {
        match route.phy_id {
            None => {
                route.rel_id == self.legacy.main_rel
                    || route
                        .project_id
                        .as_ref()
                        .and_then(|project| self.legacy.projects.get(project))
                        .is_some_and(|owner| owner.rel_id == route.rel_id)
            }
            Some(phy_id) => {
                self.has_phy(phy_id)
                    && self.owners.get(&route.rel_id).is_some_and(|entry| {
                        entry.kind == OwnerKind::Rel
                            && (entry.general
                                || route
                                    .project_id
                                    .as_ref()
                                    .is_some_and(|project| entry.projects.contains(project)))
                    })
            }
        }
    }

    pub(super) fn next(
        &self,
        changes: &SwitchChanges<ReviewedOwner>,
    ) -> Result<Self, RegistryError> {
        let mut next = self.clone();
        next.record_assignments(changes)?;
        if next != *self {
            next.generation = self
                .generation
                .checked_add(1)
                .ok_or(RegistryError::Conflict("owner_switch_generation_exhausted"))?;
        }
        next.check_size()?;
        Ok(next)
    }

    fn record_assignments(
        &mut self,
        changes: &SwitchChanges<ReviewedOwner>,
    ) -> Result<(), RegistryError> {
        changes.verify_project_ids()?;
        if let Some(main) = &changes.main_rel {
            self.record_owner(main, OwnerKind::Rel)?.general = true;
            self.main_rel = main.owner_id;
        }
        if let Some(phy) = &changes.active_phy {
            self.record_owner(phy, OwnerKind::Phylactery)?;
            self.active_phy = phy.owner_id;
        }
        for (project, owner) in &changes.projects {
            self.record_owner(owner, OwnerKind::Rel)?
                .projects
                .insert(project.clone());
            self.projects.insert(
                project.clone(),
                ProjectOwner {
                    parent_id: self.main_rel,
                    rel_id: owner.owner_id,
                },
            );
        }
        if self.projects.len() > MAX_PROJECTS {
            return Err(RegistryError::Invalid("invalid_project"));
        }
        for project in self.projects.values_mut() {
            project.parent_id = self.main_rel;
        }
        check_unique_roles(self.main_rel, self.active_phy, &self.projects)
    }

    fn record_owner(
        &mut self,
        selected: &ReviewedOwner,
        kind: OwnerKind,
    ) -> Result<&mut RegisteredOwner, RegistryError> {
        if self
            .owners
            .iter()
            .any(|(id, owner)| *id != selected.owner_id && owner.path == selected.path)
        {
            return Err(RegistryError::Conflict("mounted_owner_changed"));
        }
        let entry = self
            .owners
            .entry(selected.owner_id)
            .or_insert_with(|| RegisteredOwner {
                path: selected.path.clone(),
                kind,
                general: false,
                projects: BTreeSet::new(),
            });
        if entry.kind != kind {
            return Err(RegistryError::Invalid("wrong_owner_kind"));
        }
        if entry.path != selected.path {
            return Err(RegistryError::Conflict("owner_path_changed"));
        }
        Ok(entry)
    }

    fn has_phy(&self, owner: OwnerId) -> bool {
        self.owners
            .get(&owner)
            .is_some_and(|entry| entry.kind == OwnerKind::Phylactery)
    }

    fn valid_role_history(
        &self,
        main: OwnerId,
        phy: OwnerId,
        projects: &BTreeMap<String, ProjectOwner>,
    ) -> bool {
        self.has_phy(phy)
            && self
                .owners
                .get(&main)
                .is_some_and(|entry| entry.kind == OwnerKind::Rel && entry.general)
            && projects.iter().all(|(project, assignment)| {
                self.owners.get(&assignment.rel_id).is_some_and(|entry| {
                    entry.kind == OwnerKind::Rel && entry.projects.contains(project)
                })
            })
    }

    fn validate(&self) -> Result<(), RegistryError> {
        self.legacy.validate()?;
        if self.version != 2
            || self.profile_id != self.legacy.profile_id
            || self.principal_id != self.legacy.principal_id
            || !valid_projects(self.main_rel, &self.projects)
            || !self.valid_role_history(self.main_rel, self.active_phy, &self.projects)
            || !self.valid_role_history(
                self.legacy.main_rel,
                self.legacy.active_phy,
                &self.legacy.projects,
            )
        {
            return Err(store::CORRUPT);
        }
        check_unique_roles(self.main_rel, self.active_phy, &self.projects)
            .map_err(|_| store::CORRUPT)?;
        let mut paths = BTreeSet::new();
        if !self.owners.values().all(|entry| {
            entry.path.is_absolute()
                && paths.insert(&entry.path)
                && match entry.kind {
                    OwnerKind::Rel => {
                        (entry.general || !entry.projects.is_empty())
                            && entry
                                .projects
                                .iter()
                                .all(|project| self.projects.contains_key(project))
                    }
                    OwnerKind::Phylactery => !entry.general && entry.projects.is_empty(),
                }
        }) {
            return Err(store::CORRUPT);
        }
        self.check_size().map_err(|_| store::CORRUPT)
    }

    fn check_size(&self) -> Result<(), RegistryError> {
        let bytes = serde_json::to_vec(self).map_err(|_| store::UNAVAILABLE)?;
        if bytes.len() >= store::MAX_TOPOLOGY_BYTES {
            return Err(RegistryError::Invalid("owner_topology_too_large"));
        }
        // A committed list of current role paths must fit the Setup response.
        check_wire_size(&self.status())
    }
}

pub(super) fn check_wire_size(value: &impl Serialize) -> Result<(), RegistryError> {
    let bytes = serde_json::to_vec(value).map_err(|_| store::UNAVAILABLE)?;
    if bytes.len() > MAX_WIRE_BYTES {
        return Err(RegistryError::Invalid("owner_topology_too_large"));
    }
    Ok(())
}

fn valid_projects(main: OwnerId, projects: &BTreeMap<String, ProjectOwner>) -> bool {
    projects.len() <= MAX_PROJECTS
        && projects
            .iter()
            .all(|(id, owner)| valid_id(id) && owner.parent_id == main)
}

fn check_unique_roles(
    main_rel: OwnerId,
    active_phy: OwnerId,
    projects: &BTreeMap<String, ProjectOwner>,
) -> Result<(), RegistryError> {
    let mut ids = BTreeSet::from([main_rel]);
    if !ids.insert(active_phy) || !projects.values().all(|project| ids.insert(project.rel_id)) {
        return Err(RegistryError::Invalid("duplicate_owner"));
    }
    Ok(())
}

fn verify_bootstrap_path(path: &Path, kind: OwnerKind) -> Result<ReviewedOwner, RegistryError> {
    verify_path(path, kind).map_err(|error| match error {
        RegistryError::Invalid("wrong_owner_kind") => RegistryError::Invalid("invalid_owner"),
        _ => error,
    })
}

pub(super) fn verify_path(path: &Path, kind: OwnerKind) -> Result<ReviewedOwner, RegistryError> {
    let path = owner_file(path)?;
    let owner = match kind {
        OwnerKind::Rel => Rel::verify(&path),
        OwnerKind::Phylactery => Phylactery::verify(&path),
    };
    let owner_id = match owner {
        Ok(info) => info.owner_id,
        Err(error) => {
            if error.kind() == ProductErrorKind::WrongFormat {
                let other_kind = match kind {
                    OwnerKind::Rel => Phylactery::verify(&path),
                    OwnerKind::Phylactery => Rel::verify(&path),
                };
                if other_kind.is_ok() {
                    return Err(RegistryError::Invalid("wrong_owner_kind"));
                }
            }
            if error.kind() == ProductErrorKind::Verification {
                return Err(RegistryError::Invalid("invalid_owner"));
            }
            return Err(owner_error(error));
        }
    };
    Ok(ReviewedOwner { path, owner_id })
}
