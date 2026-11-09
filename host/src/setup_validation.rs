//! One-shot setup preflight over Root's read-only owner verification.
use super::{
    OwnerConfig, RegistryError, TOPOLOGY_FILE, owner_error, owner_file, validate_rel_scope,
};
use crate::{
    service_http::MAX_WIRE_BYTES, service_protocol::decode, source_ingest::open_processing_runtime,
};
use reliquary_memory::{
    OwnerId, OwnerInfo, OwnerKind, OwnerScope, Phylactery, ProductErrorKind, Rel,
};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    collections::BTreeMap,
    io::{self, Read},
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    owners: OwnerConfig,
    config_path: Option<PathBuf>,
}

#[derive(Serialize)]
struct Report {
    valid: bool,
    main_rel: OwnerCheck,
    active_phy: OwnerCheck,
    projects: BTreeMap<String, OwnerCheck>,
    config: ConfigCheck,
    topology_error: Option<&'static str>,
}

#[derive(Serialize)]
struct OwnerCheck {
    accepted: bool,
    opened: bool,
    kind: Option<&'static str>,
    owner_id: Option<OwnerId>,
    scope: Option<OwnerScope>,
    error: Option<&'static str>,
}

#[derive(Serialize)]
struct ConfigCheck {
    accepted: bool,
    opened: bool,
    error: Option<&'static str>,
}

#[path = "setup_create.rs"]
mod create;
pub(crate) use create::run as run_create;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Role {
    MainRel,
    ActivePhy,
    ProjectRel,
}

impl Role {
    fn check(self, path: &Path) -> OwnerCheck {
        let file = match owner_file(path) {
            Ok(file) => file,
            Err(error) => return OwnerCheck::failed(error.code()),
        };
        let verify = match self {
            Self::ActivePhy => Phylactery::verify(&file),
            Self::MainRel | Self::ProjectRel => Rel::verify(&file),
        };
        let info = match verify {
            Ok(info) => Ok(info),
            // Detect a wrong-kind selection through the other public Root API.
            Err(error) if error.kind() == ProductErrorKind::WrongFormat => match self {
                Self::ActivePhy => Rel::verify(&file).or(Err(error)),
                Self::MainRel | Self::ProjectRel => Phylactery::verify(&file).or(Err(error)),
            },
            Err(error) => Err(error),
        };
        match info {
            Ok(info) => self.report(info),
            Err(error) if error.kind() == ProductErrorKind::Verification => {
                OwnerCheck::failed("invalid_owner")
            }
            Err(error) => OwnerCheck::failed(owner_error(error).code()),
        }
    }

    fn report(self, info: OwnerInfo) -> OwnerCheck {
        let error = match (self, info.kind) {
            (Self::ActivePhy, OwnerKind::Phylactery) => None,
            (Self::MainRel | Self::ProjectRel, OwnerKind::Rel) => {
                validate_rel_scope(info.scope, matches!(self, Self::ProjectRel))
                    .err()
                    .map(|error| error.code())
            }
            _ => Some("wrong_owner_kind"),
        };
        OwnerCheck {
            accepted: error.is_none(),
            opened: true,
            kind: Some(match info.kind {
                OwnerKind::Rel => "rel",
                OwnerKind::Phylactery => "phy",
            }),
            owner_id: Some(info.owner_id),
            scope: (info.kind == OwnerKind::Rel).then_some(info.scope),
            error,
        }
    }
}

impl OwnerCheck {
    fn failed(code: &'static str) -> Self {
        Self {
            accepted: false,
            opened: false,
            kind: None,
            owner_id: None,
            scope: None,
            error: Some(code),
        }
    }

    fn accepted_id(&self) -> Option<OwnerId> {
        self.owner_id.filter(|_| self.accepted)
    }
}

fn report(request: Request, state_dir: &Path) -> Result<Report, RegistryError> {
    let owners = request.owners;
    owners.validate()?;
    let main_rel = Role::MainRel.check(&owners.main_rel);
    let active_phy = Role::ActivePhy.check(&owners.active_phy);
    let projects: BTreeMap<_, _> = owners
        .projects
        .iter()
        .map(|(project, path)| (project.clone(), Role::ProjectRel.check(path)))
        .collect();
    let project_ids: Option<BTreeMap<_, _>> = projects
        .iter()
        .map(|(project, check)| check.accepted_id().map(|id| (project.clone(), id)))
        .collect();
    let owner_ids = (
        main_rel.accepted_id(),
        active_phy.accepted_id(),
        project_ids,
    );
    let topology_error = match owner_ids {
        (Some(main_id), Some(phy_id), Some(project_ids)) => owners
            .topology(main_id, phy_id, project_ids)
            .and_then(|topology| topology.is_accepted(&state_dir.join(TOPOLOGY_FILE)))
            .err()
            .map(|error| error.code()),
        _ => None,
    };
    let config_error = request
        .config_path
        .as_deref()
        .and_then(|path| open_processing_runtime(path).err());
    let config = ConfigCheck {
        accepted: config_error.is_none(),
        opened: request.config_path.is_some() && config_error.is_none(),
        error: config_error,
    };
    Ok(Report {
        valid: main_rel.accepted
            && active_phy.accepted
            && projects.values().all(|check| check.accepted)
            && config.accepted
            && topology_error.is_none(),
        main_rel,
        active_phy,
        projects,
        config,
        topology_error,
    })
}

fn read_request<T: DeserializeOwned>(state_dir: &Path) -> Result<T, &'static str> {
    if !state_dir.is_absolute() {
        return Err("invalid_state_directory");
    }
    let mut raw = Vec::new();
    io::stdin()
        .lock()
        .take(MAX_WIRE_BYTES as u64 + 1)
        .read_to_end(&mut raw)
        .map_err(|_| "invalid_setup_request")?;
    if raw.len() > MAX_WIRE_BYTES {
        return Err("invalid_setup_request");
    }
    decode(&raw).map_err(|_| "invalid_setup_request")
}

fn write_report(report: &impl Serialize) -> Result<(), &'static str> {
    serde_json::to_writer(io::stdout().lock(), report).map_err(|_| "setup_response_unavailable")
}

pub(crate) fn run(state_dir: &Path) -> Result<(), &'static str> {
    let request = read_request(state_dir)?;
    write_report(&report(request, state_dir).map_err(|error| error.code())?)
}
