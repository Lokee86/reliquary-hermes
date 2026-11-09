use super::RegistryError;
use serde::{
    Deserialize, Deserializer, Serialize,
    de::{DeserializeOwned, Error, MapAccess, Visitor},
};
use std::{
    collections::BTreeMap,
    fmt,
    fs::{self, File},
    io::{ErrorKind, Read, Write},
    marker::PhantomData,
    path::Path,
};

pub(super) const MAX_SESSION_BYTES: usize = 1024;
pub(super) const MAX_TOPOLOGY_BYTES: usize = 65_536;
pub(super) const UNAVAILABLE: RegistryError = RegistryError::Unavailable("state_unavailable");
const CORRUPT: RegistryError = RegistryError::Unavailable("state_corrupt");

pub(crate) fn read<T: DeserializeOwned>(
    path: &Path,
    maximum: usize,
) -> Result<Option<T>, RegistryError> {
    match path.symlink_metadata() {
        Ok(metadata) if metadata.is_file() => {}
        Ok(_) => return Err(CORRUPT),
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(UNAVAILABLE),
    }
    let file = File::open(path).map_err(|_| UNAVAILABLE)?;
    let mut raw = Vec::new();
    file.take(maximum as u64 + 1)
        .read_to_end(&mut raw)
        .map_err(|_| UNAVAILABLE)?;
    if raw.len() > maximum {
        return Err(CORRUPT);
    }
    serde_json::from_slice(&raw).map(Some).map_err(|_| CORRUPT)
}

pub(super) fn sessions_dir(path: &Path, accepted_topology: bool) -> Result<(), RegistryError> {
    if !accepted_topology {
        fs::create_dir_all(path).map_err(|_| UNAVAILABLE)?;
    }
    if !path
        .symlink_metadata()
        .is_ok_and(|metadata| metadata.is_dir())
    {
        return Err(CORRUPT);
    }
    if !accepted_topology
        && fs::read_dir(path)
            .map_err(|_| UNAVAILABLE)?
            .next()
            .is_some()
    {
        return Err(CORRUPT);
    }
    Ok(())
}

fn synced_temporary(
    path: &Path,
    value: &impl Serialize,
) -> Result<tempfile::NamedTempFile, RegistryError> {
    let directory = path.parent().ok_or(UNAVAILABLE)?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".binding-")
        .tempfile_in(directory)
        .map_err(|_| UNAVAILABLE)?;
    serde_json::to_writer(&mut temporary, value).map_err(|_| UNAVAILABLE)?;
    temporary.write_all(b"\n").map_err(|_| UNAVAILABLE)?;
    temporary.as_file().sync_all().map_err(|_| UNAVAILABLE)?;
    Ok(temporary)
}

pub(super) fn replace(path: &Path, value: &impl Serialize) -> Result<(), RegistryError> {
    synced_temporary(path, value)?
        .persist(path)
        .map_err(|_| UNAVAILABLE)?;
    sync_parent(path)
}

pub(crate) fn publish(path: &Path, value: &impl Serialize) -> Result<(), RegistryError> {
    synced_temporary(path, value)?
        .persist_noclobber(path)
        .map_err(|error| {
            if error.error.kind() == ErrorKind::AlreadyExists {
                RegistryError::Conflict("state_publication_conflict")
            } else {
                UNAVAILABLE
            }
        })?;
    sync_parent(path)
}

pub(crate) fn sync_parent(path: &Path) -> Result<(), RegistryError> {
    #[cfg(unix)]
    {
        let directory = path.parent().ok_or(UNAVAILABLE)?;
        File::open(directory)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| UNAVAILABLE)?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

pub(super) fn unique_map<'de, D, K, V>(deserializer: D) -> Result<BTreeMap<K, V>, D::Error>
where
    D: Deserializer<'de>,
    K: Deserialize<'de> + Ord,
    V: Deserialize<'de>,
{
    struct UniqueMap<K, V>(PhantomData<(K, V)>);

    impl<'de, K: Deserialize<'de> + Ord, V: Deserialize<'de>> Visitor<'de> for UniqueMap<K, V> {
        type Value = BTreeMap<K, V>;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("an object with unique keys")
        }

        fn visit_map<A: MapAccess<'de>>(self, mut entries: A) -> Result<Self::Value, A::Error> {
            let mut result = BTreeMap::new();
            while let Some((key, value)) = entries.next_entry()? {
                if result.insert(key, value).is_some() {
                    return Err(A::Error::custom("duplicate object key"));
                }
            }
            Ok(result)
        }
    }

    deserializer.deserialize_map(UniqueMap(PhantomData))
}
