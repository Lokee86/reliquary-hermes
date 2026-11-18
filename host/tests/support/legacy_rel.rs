//! Empty REL 2.1 files emitted by Core 36c6383a before scope-free creation.
use serde::Deserialize;

#[derive(Clone, Copy, Deserialize)]
pub(super) struct LegacyRel<'a> {
    pub scope: &'a str,
    pub owner_id: &'a str,
    hex: &'a str,
}

impl LegacyRel<'_> {
    pub fn bytes(self) -> Vec<u8> {
        self.hex
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect()
    }
}

pub(super) fn role_pairs() -> impl Iterator<Item = (LegacyRel<'static>, LegacyRel<'static>)> {
    let fixtures: [LegacyRel<'static>; 3] =
        serde_json::from_str(include_str!("legacy-rel-2.1.json")).unwrap();
    // Exercise each original scope in both roles without using the same owner twice.
    fixtures
        .into_iter()
        .zip(fixtures.into_iter().cycle().skip(1))
}
