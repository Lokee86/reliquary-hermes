//! Live mount staging and publication of accepted assignments.
use super::{
    Admissions, Gateway, HostCredentialBinding, OwnerGrant, OwnerId, OwnerKind, Path,
    ProductErrorKind, RegisteredOwner, Registry, RegistryError, SwitchChanges, SwitchReview,
    SwitchStatus, Topology, TrustedHostAdmission, owner_error, owner_file, store,
    topology::{ReviewedOwner, check_wire_size, verify_path},
};
use std::collections::BTreeSet;

const STALE: RegistryError = RegistryError::Conflict("owner_switch_stale");
const CHANGED: RegistryError = RegistryError::Conflict("mounted_owner_changed");
const RECOVERY_REQUIRED: RegistryError =
    RegistryError::Unavailable("owner_switch_recovery_required");
type StagedMount = (OwnerId, OwnerKind);

impl Registry {
    pub(crate) fn switch_status(&self) -> Result<SwitchStatus, RegistryError> {
        self.require_current()?;
        Ok(self.topology.status())
    }

    pub(crate) fn review_switch(
        &self,
        changes: SwitchChanges<std::path::PathBuf>,
    ) -> Result<SwitchReview, RegistryError> {
        self.require_current()?;
        changes.verify_project_ids()?;
        let changes = changes.map(|path, kind| self.review_owner(&path, kind))?;
        self.topology.next(&changes)?;
        let review = SwitchReview {
            generation: self.topology.generation,
            changes,
        };
        check_wire_size(&review)?;
        Ok(review)
    }

    pub(crate) fn apply_switch(
        &mut self,
        review: SwitchReview,
    ) -> Result<SwitchStatus, RegistryError> {
        self.require_current()?;
        if review.generation != self.topology.generation {
            return Err(STALE);
        }
        review.changes.verify_project_ids()?;
        let changes = review.changes.map(|expected, _| {
            Ok(ReviewedOwner {
                path: owner_file(&expected.path)?,
                owner_id: expected.owner_id,
            })
        })?;
        let next = self.topology.next(&changes)?;
        if next == self.topology {
            return self.switch_status();
        }

        // Staged management admissions must wait for the new topology to commit.
        if self.perception_runtime.is_some() {
            self.gateway
                .set_perception_runtime(None)
                .map_err(owner_error)?;
        }
        let result = self.commit_switch(next);
        if let Some((_, runtime)) = &self.perception_runtime {
            if self.gateway.set_perception_runtime(Some(runtime)).is_err() {
                self.fence();
                return Err(RECOVERY_REQUIRED);
            }
        }
        result
    }

    fn commit_switch(&mut self, next: Topology) -> Result<SwitchStatus, RegistryError> {
        let mut staged = Vec::new();
        let (mounted_rels, admissions) = match self.stage_switch(&next, &mut staged) {
            Ok(staged) => staged,
            Err(error) => return Err(self.abort_switch(&staged, error)),
        };

        // The process lease excludes other registry writers. A missing or
        // different file still requires recovery, never an overwrite from RAM.
        if !store::read::<Topology>(&self.topology_path, store::MAX_TOPOLOGY_BYTES)
            .is_ok_and(|disk| disk.as_ref() == Some(&self.topology))
        {
            self.fence();
            return Err(self.abort_switch(&staged, RECOVERY_REQUIRED));
        }
        if let Err(error) = store::replace(&self.topology_path, &next) {
            let durable = store::read::<Topology>(&self.topology_path, store::MAX_TOPOLOGY_BYTES)
                .and_then(|disk| {
                    store::sync_parent(&self.topology_path)?;
                    Ok(disk)
                })
                .ok()
                .flatten();
            match durable.as_ref() {
                Some(disk) if disk == &next => {}
                Some(disk) if disk == &self.topology => {
                    return Err(self.abort_switch(&staged, error));
                }
                _ => {
                    self.fence();
                    return Err(self.abort_switch(&staged, RECOVERY_REQUIRED));
                }
            }
        }

        let previous_phy = self.active_phy();
        let previous_admissions = std::mem::replace(&mut self.admissions, admissions);
        self.topology = next;
        self.mounted_rels = mounted_rels;

        let revoked = previous_admissions.revoke(&self.credential);
        let detached = if previous_phy != self.active_phy() {
            previous_admissions
                .provider_control
                .detach_read_only_phylactery(previous_phy)
                .map_err(owner_error)
        } else {
            Ok(())
        };
        if revoked.and(detached).is_err() {
            self.fence();
            return Err(RECOVERY_REQUIRED);
        }
        self.switch_status()
    }

    fn review_owner(&self, path: &Path, kind: OwnerKind) -> Result<ReviewedOwner, RegistryError> {
        let path = owner_file(path)?;
        // Root's independent verification can report a writer conflict for a
        // path already held by our Gateway. That mount is our evidence there.
        for (&owner_id, owner) in &self.topology.owners {
            if owner.path == path
                && (owner_id == self.active_phy() || self.mounted_rels.contains(&owner_id))
            {
                if owner.kind != kind {
                    return Err(RegistryError::Invalid("wrong_owner_kind"));
                }
                return Ok(ReviewedOwner { path, owner_id });
            }
        }
        verify_path(&path, kind)
    }

    fn stage_switch(
        &self,
        next: &Topology,
        staged: &mut Vec<StagedMount>,
    ) -> Result<(BTreeSet<OwnerId>, Admissions), RegistryError> {
        let mut mounted_rels = self.mounted_rels.clone();
        for owner in std::iter::once(next.main_rel)
            .chain(next.projects.values().map(|project| project.rel_id))
        {
            if mounted_rels.insert(owner) {
                staged.push(mount_registered(
                    &self.gateway,
                    owner,
                    &next.owners[&owner],
                )?);
            }
        }
        if next.active_phy != self.active_phy() {
            staged.push(mount_registered(
                &self.gateway,
                next.active_phy,
                &next.owners[&next.active_phy],
            )?);
        }
        let admissions = Admissions::new(&self.gateway, next, &mounted_rels, &self.credential)?;
        Ok((mounted_rels, admissions))
    }

    fn abort_switch(&mut self, staged: &[StagedMount], error: RegistryError) -> RegistryError {
        if discard_mounts(&self.gateway, &self.credential, staged).is_err() {
            self.fence();
            return RECOVERY_REQUIRED;
        }
        error
    }
}

impl Admissions {
    pub(super) fn new(
        gateway: &Gateway,
        topology: &Topology,
        rels: &BTreeSet<OwnerId>,
        credential: &str,
    ) -> Result<Self, RegistryError> {
        let (dashboard, dashboard_control) =
            TrustedHostAdmission::new([HostCredentialBinding::new(
                topology.active_phy.to_string(),
                credential,
                rels.iter().copied().map(OwnerGrant::ManageRel),
            )])
            .install(gateway)
            .map_err(owner_error)?;
        let dashboard_actor = dashboard.authenticate(credential).map_err(owner_error)?;
        let (provider, provider_control) = TrustedHostAdmission::new([HostCredentialBinding::new(
            &topology.principal_id,
            credential,
            rels.iter()
                .copied()
                .map(OwnerGrant::OperateRel)
                .chain([OwnerGrant::ViewPhylactery(topology.active_phy)]),
        )])
        .install(gateway)
        .map_err(owner_error)?;
        let provider_instance = provider.authenticate(credential).map_err(owner_error)?;
        Ok(Self {
            provider,
            provider_instance,
            provider_control,
            dashboard_actor,
            dashboard_control,
        })
    }

    pub(super) fn revoke(&self, credential: &str) -> Result<(), RegistryError> {
        let provider = self.provider_control.revoke(credential);
        let dashboard = self.dashboard_control.revoke(credential);
        provider.and(dashboard).map_err(owner_error)
    }
}

pub(super) fn mount_on_startup(
    gateway: &Gateway,
    topology: &Topology,
) -> Result<BTreeSet<OwnerId>, RegistryError> {
    mount_registered(
        gateway,
        topology.active_phy,
        &topology.owners[&topology.active_phy],
    )?;
    let mut rels = BTreeSet::new();
    for (&owner, entry) in &topology.owners {
        if entry.kind != OwnerKind::Rel {
            continue;
        }
        match mount_registered(gateway, owner, entry) {
            Ok(_) => {
                rels.insert(owner);
            }
            Err(error) if topology.current_rel(owner) => return Err(error),
            Err(_) => {}
        }
    }
    Ok(rels)
}

fn mount_registered(
    gateway: &Gateway,
    expected: OwnerId,
    owner: &RegisteredOwner,
) -> Result<StagedMount, RegistryError> {
    let path = owner_file(&owner.path)?;
    if path != owner.path {
        return Err(CHANGED);
    }
    let mounted = gateway
        .mount_owner_path(
            &path,
            owner.kind,
            owner.kind == OwnerKind::Rel,
            Some(expected),
        )
        .map_err(|error| match error.kind() {
            ProductErrorKind::Admission => CHANGED,
            _ => owner_error(error),
        })?;
    Ok((mounted, owner.kind))
}

fn discard_mounts(
    gateway: &Gateway,
    credential: &str,
    staged: &[StagedMount],
) -> Result<(), RegistryError> {
    if staged.is_empty() {
        return Ok(());
    }
    let grants = staged.iter().map(|&(owner, kind)| match kind {
        OwnerKind::Rel => OwnerGrant::ManageRel(owner),
        OwnerKind::Phylactery => OwnerGrant::ViewPhylactery(owner),
    });
    let (adapter, control) =
        TrustedHostAdmission::new([HostCredentialBinding::new("setup", credential, grants)])
            .install(gateway)
            .map_err(owner_error)?;
    let cleanup = adapter.authenticate(credential).map_err(owner_error)?;
    let mut result = Ok(());
    for &(owner, kind) in staged.iter().rev() {
        let removed = match kind {
            OwnerKind::Rel => cleanup
                .workspace_management(owner)
                .and_then(|rel| rel.quiesce()),
            OwnerKind::Phylactery => control.detach_read_only_phylactery(owner),
        };
        result = result.and(removed.map_err(owner_error));
    }
    result
}
