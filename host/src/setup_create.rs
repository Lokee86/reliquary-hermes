//! Create an explicitly requested owner through Root, then publish it without clobbering.
use super::{OwnerCheck, Role, read_request, write_report};
use crate::registry::store;
use reliquary_memory::{OwnerScope, Phylactery, Rel};
use serde::Deserialize;
use std::{
    io::ErrorKind,
    path::{Component, Path, PathBuf},
};
use tempfile::{Builder, TempPath};

const INVALID_PATH: &str = "invalid_owner_path";
const OCCUPIED: &str = "owner_already_exists";
const CREATE_FAILED: &str = "owner_creation_failed";
const CREATED_UNVERIFIED: &str = "owner_created_unverified";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    role: Role,
    path: PathBuf,
}

pub(crate) fn run(state_dir: &Path) -> Result<(), &'static str> {
    let Request { role, path } = read_request(state_dir)?;
    write_report(&create(role, &path)?).map_err(|_| CREATED_UNVERIFIED)
}

fn create(role: Role, path: &Path) -> Result<OwnerCheck, &'static str> {
    let destination = destination(path, role)?;
    let parent = destination.parent().ok_or(INVALID_PATH)?;
    match destination.symlink_metadata() {
        Ok(_) => return Err(OCCUPIED),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(_) => return Err(CREATE_FAILED),
    }

    // Root requires a new path. Stage beside the destination so an interrupted
    // initialization cannot leave a partial owner at the requested path.
    let mut staging = Builder::new();
    staging.prefix(".reliquary-owner-");
    #[cfg(unix)]
    {
        use std::{fs::Permissions, os::unix::fs::PermissionsExt};
        staging.permissions(Permissions::from_mode(0o700));
    }
    let stage = staging.tempdir_in(parent).map_err(|_| CREATE_FAILED)?;
    let staged = TempPath::try_from_path(stage.path().join("owner")).map_err(|_| CREATE_FAILED)?;
    let owner_id = match role {
        Role::MainRel => {
            Rel::create(&staged, OwnerScope::Unspecified).map(|owner| owner.owner_id())
        }
        Role::ProjectRel => Rel::create(&staged, OwnerScope::Project).map(|owner| owner.owner_id()),
        Role::ActivePhy => Phylactery::create(&staged).map(|owner| owner.owner_id()),
    }
    .map_err(|_| CREATE_FAILED)?;
    if !ordinary_directory(parent) {
        return Err(INVALID_PATH);
    }
    staged.persist_noclobber(&destination).map_err(|error| {
        if error.error.kind() == ErrorKind::AlreadyExists {
            OCCUPIED
        } else {
            CREATE_FAILED
        }
    })?;
    store::sync_parent(&destination).map_err(|_| CREATED_UNVERIFIED)?;

    let report = role.check(&destination);
    if report.accepted_id() != Some(owner_id) {
        return Err(CREATED_UNVERIFIED);
    }
    Ok(report)
}

fn destination(path: &Path, role: Role) -> Result<PathBuf, &'static str> {
    let raw = path.to_str().ok_or(INVALID_PATH)?;
    let name = path.file_name().ok_or(INVALID_PATH)?;
    let extension = match role {
        Role::MainRel | Role::ProjectRel => "rel",
        Role::ActivePhy => "phy",
    };
    if !path.is_absolute()
        || raw.starts_with("//")
        || raw.rsplit(std::path::is_separator).next() != name.to_str()
        || raw.len() > 4096
        || raw.chars().any(char::is_control)
        || path.components().any(|component| match component {
            Component::ParentDir => true,
            Component::Normal(name) => !valid_component(name),
            _ => false,
        })
        || !path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case(extension))
    {
        return Err(INVALID_PATH);
    }
    #[cfg(windows)]
    if !matches!(
        path.components().next(),
        Some(Component::Prefix(prefix)) if matches!(prefix.kind(), std::path::Prefix::Disk(_))
    ) {
        return Err(INVALID_PATH);
    }
    let parent = path.parent().ok_or(INVALID_PATH)?;
    if !ordinary_directory(parent) {
        return Err(INVALID_PATH);
    }
    let parent = parent.canonicalize().map_err(|_| INVALID_PATH)?;
    #[cfg(windows)]
    if !matches!(
        parent.components().next(),
        Some(Component::Prefix(prefix)) if matches!(prefix.kind(), std::path::Prefix::VerbatimDisk(_))
    ) {
        return Err(INVALID_PATH);
    }
    Ok(parent.join(name))
}

#[cfg(windows)]
fn valid_component(name: &std::ffi::OsStr) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    let base = name.split('.').next().unwrap_or(name).trim_end();
    let base = base.to_ascii_uppercase();
    !name.ends_with([' ', '.'])
        && !name.contains(['<', '>', ':', '"', '|', '?', '*'])
        && !matches!(
            base.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        )
        && !["COM", "LPT"].into_iter().any(|prefix| {
            base.strip_prefix(prefix).is_some_and(|number| {
                matches!(number.as_bytes(), [b'1'..=b'9']) || matches!(number, "¹" | "²" | "³")
            })
        })
}

#[cfg(not(windows))]
fn valid_component(_name: &std::ffi::OsStr) -> bool {
    true
}

fn ordinary_directory(path: &Path) -> bool {
    let ancestors: Vec<_> = path.ancestors().collect();
    ancestors.into_iter().rev().all(|directory| {
        directory.symlink_metadata().is_ok_and(|metadata| {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
                if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                    return false;
                }
            }
            metadata.is_dir()
        })
    })
}
