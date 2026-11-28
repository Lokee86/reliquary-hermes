//! Apply the same copied-source checks to selected Memories and Observation lineage.
use super::*;
use reliquary_memory::{
    InspectionItem, InspectionQuery, MemoryId, MemoryTextField, ObservationCitation,
    ObservationMemoryLineage, ObservationSource, ObservationStatus, ObservationTimeScope,
    ObservationValidity, OwnerKind, RetrievalMemory, RetrievalPreview, WorkspaceManagement,
};
use std::fmt::Write;

pub(crate) struct RetrievalDisclosure {
    pub(crate) provenance: Vec<RetrievalProvenance>,
    pub(crate) observations: Vec<ReturnedObservation>,
}

#[derive(Serialize)]
pub(crate) struct RetrievalProvenance {
    owner_id: String,
    memory_id: String,
    source_snapshot_digests: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_principal_id: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct ReturnedObservation {
    owner_id: String,
    observation_id: String,
    revision: u64,
    body_id: String,
    claim: String,
    status: ObservationStatus,
    time_scope: ObservationTimeScope,
    validity: Option<ObservationValidity>,
    evidence: Vec<ObservationEvidence>,
    lineage: Vec<LineageProvenance>,
}

#[derive(Serialize)]
struct ObservationEvidence {
    owner_id: String,
    history_generation: String,
    source_kind: &'static str,
    source_id: String,
    revision: u64,
    body_id: String,
    field: MemoryTextField,
    start_byte: u32,
    end_byte: u32,
}

impl From<&ObservationCitation> for ObservationEvidence {
    fn from(citation: &ObservationCitation) -> Self {
        let (source_kind, source_id) = match citation.source {
            ObservationSource::Memory(id) => ("memory", id),
            ObservationSource::Observation(id) => ("observation", id.0),
        };
        Self {
            owner_id: hex(&citation.owner_id),
            history_generation: hex(&citation.history_generation),
            source_kind,
            source_id: hex(&source_id),
            revision: citation.revision,
            body_id: hex(&citation.body_id),
            field: citation.field,
            start_byte: citation.start_byte,
            end_byte: citation.end_byte,
        }
    }
}

#[derive(Serialize)]
struct LineageProvenance {
    memory_id: String,
    revision: u64,
    body_id: String,
    source_snapshot_digests: Vec<String>,
}

impl ReturnedObservation {
    pub(crate) fn render(&self, context: &mut String) {
        if !context.is_empty() {
            context.push_str("\n\n");
        }
        let _ = write!(
            context,
            "Observation ({:?}, {:?}): {}\nEvidence:",
            self.status, self.time_scope, self.claim,
        );
        for cite in &self.evidence {
            let _ = write!(
                context,
                "\n- {} {}/{} revision {}, {:?} bytes {}–{}",
                cite.source_kind,
                cite.owner_id,
                cite.source_id,
                cite.revision,
                cite.field,
                cite.start_byte,
                cite.end_byte,
            );
        }
    }
}

impl SourceService {
    pub(crate) fn retrieval_disclosure(
        &self,
        instance: &Instance,
        registry: &Registry,
        runtimes: &mut RuntimeRegistry,
        owner: OwnerId,
        active_phy: OwnerId,
        selection: &RetrievalPreview,
    ) -> Result<RetrievalDisclosure, HttpError> {
        let mut checks = SourceChecks {
            service: self,
            instance,
            registry,
            runtimes,
            owner,
            management: instance
                .workspace_management(owner)
                .map_err(|_| PROVENANCE_UNAVAILABLE)?,
            heads: BTreeMap::new(),
        };
        let rel = owner.to_string();
        let phy = active_phy.to_string();
        let mut provenance = Vec::with_capacity(selection.memories.len());
        for memory in &selection.memories {
            let proof = if memory.owner_id == rel {
                checks.selected_memory(memory, owner, OwnerKind::Rel)?
            } else if memory.owner_id == phy {
                checks.selected_memory(memory, active_phy, OwnerKind::Phylactery)?
            } else {
                return Err(PROVENANCE_UNAVAILABLE);
            };
            provenance.push(proof);
        }
        let mut checked_lineage: BTreeMap<_, Vec<String>> = BTreeMap::new();
        let mut observations = Vec::with_capacity(selection.observations.len());
        for hit in &selection.observations {
            let claim = &hit.claim;
            let ObservationSource::Observation(id) = claim.citation.source else {
                return Err(PROVENANCE_UNAVAILABLE);
            };

            let in_rel = claim.citation.owner_id == owner.as_bytes();
            if !in_rel && claim.citation.owner_id != active_phy.as_bytes() {
                return Err(PROVENANCE_UNAVAILABLE);
            }
            let mut lineage = Vec::with_capacity(claim.lineage.len());
            for source in &claim.lineage {
                let source_snapshot_digests = if in_rel {
                    match checked_lineage.entry(*source) {
                        std::collections::btree_map::Entry::Occupied(entry) => {
                            entry.into_mut().clone()
                        }
                        std::collections::btree_map::Entry::Vacant(entry) => {
                            entry.insert(checks.lineage_memory(source)?).clone()
                        }
                    }
                } else {
                    Vec::new()
                };
                lineage.push(LineageProvenance {
                    memory_id: hex(&source.memory_id),
                    revision: source.revision,
                    body_id: hex(&source.body_id),
                    source_snapshot_digests,
                });
            }
            observations.push(ReturnedObservation {
                owner_id: hex(&claim.citation.owner_id),
                observation_id: hex(&id.0),
                revision: claim.citation.revision,
                body_id: hex(&claim.citation.body_id),
                claim: claim.proposition.clone(),
                status: claim.status,
                time_scope: claim.time_scope,
                validity: claim.validity,
                evidence: claim
                    .support
                    .iter()
                    .map(ObservationEvidence::from)
                    .collect(),
                lineage,
            });
        }
        Ok(RetrievalDisclosure {
            provenance,
            observations,
        })
    }
}

struct SourceChecks<'a> {
    service: &'a SourceService,
    instance: &'a Instance,
    registry: &'a Registry,
    runtimes: &'a mut RuntimeRegistry,
    owner: OwnerId,
    management: WorkspaceManagement,
    heads: BTreeMap<String, Option<SourceHead>>,
}

impl SourceChecks<'_> {
    fn selected_memory(
        &mut self,
        memory: &RetrievalMemory,
        owner: OwnerId,
        kind: OwnerKind,
    ) -> Result<RetrievalProvenance, HttpError> {
        let sourced = match kind {
            OwnerKind::Phylactery => {
                memory.source.owner_id.is_some() && memory.source.principal_id.is_some()
            }
            OwnerKind::Rel => {
                memory.source.episode_id.is_some()
                    || memory.source.content_conversation_id.is_some()
                    || memory.source.grounding_conversation_id.is_some()
            }
        };
        let (source_snapshot_digests, source_principal_id) = if sourced {
            self.check_memory_source(
                owner,
                kind,
                memory_id(&memory.memory_id)?,
                &memory.memory_id,
                memory.revision,
                &memory.body_id,
            )?
        } else {
            (Vec::new(), None)
        };
        Ok(RetrievalProvenance {
            owner_id: memory.owner_id.clone(),
            memory_id: memory.memory_id.clone(),
            source_snapshot_digests,
            source_principal_id,
        })
    }

    fn lineage_memory(
        &mut self,
        source: &ObservationMemoryLineage,
    ) -> Result<Vec<String>, HttpError> {
        let id = MemoryId(source.memory_id);
        let memory = self
            .management
            .memory(id)
            .map_err(|_| PROVENANCE_UNAVAILABLE)?;
        if memory.id != hex(&source.memory_id)
            || memory.revision != source.revision
            || memory.body_id != hex(&source.body_id)
            || memory.archived
            || !memory.payload_available
        {
            return Err(PROVENANCE_UNAVAILABLE);
        }
        self.check_memory_source(
            self.owner,
            OwnerKind::Rel,
            id,
            &memory.id,
            memory.revision,
            &memory.body_id,
        )
        .map(|(digests, _)| digests)
    }

    fn check_memory_source(
        &mut self,
        owner: OwnerId,
        kind: OwnerKind,
        id: MemoryId,
        memory_id: &str,
        revision: u64,
        body_id: &str,
    ) -> Result<(Vec<String>, Option<String>), HttpError> {
        let page = self
            .instance
            .inspect_owner(
                owner,
                kind,
                &InspectionQuery::Provenance {
                    id,
                    revision: Some(revision),
                },
                None,
                1,
            )
            .map_err(|_| PROVENANCE_UNAVAILABLE)?;
        let [InspectionItem::Provenance(evidence)] = page.items.as_slice() else {
            return Err(PROVENANCE_UNAVAILABLE);
        };
        if page.truncated
            || page.cut.owner_id != owner.as_bytes()
            || evidence.memory_id != memory_id
            || evidence.body_id != body_id
            || evidence.revision != revision
        {
            return Err(PROVENANCE_UNAVAILABLE);
        }
        let copied = |turn: &SourceTurn| turn.conversation_id.starts_with("hermes-copy:");
        if kind == OwnerKind::Phylactery && !evidence.source_turn.as_ref().is_some_and(copied) {
            return Ok((Vec::new(), None));
        }
        match evidence.availability {
            SourceAvailability::Terminal => return Err(TERMINAL),
            SourceAvailability::Available | SourceAvailability::Direct => {}
            _ => return Err(PROVENANCE_UNAVAILABLE),
        }

        let source_owner = evidence
            .source_owner_id
            .as_deref()
            .and_then(|id| id.parse::<OwnerId>().ok())
            .unwrap_or(owner);
        let source_principal_id = evidence
            .source_turn
            .as_ref()
            .filter(|turn| copied(turn))
            .and_then(|turn| {
                let author = turn.imported.as_ref()?.source_author.as_ref()?;
                let principal = turn.principal_id.as_ref()?;
                (turn.role == "user"
                    && author.is_bot == Some(false)
                    && author.id.as_ref() == Some(principal))
                .then(|| principal.clone())
            });
        let mut digests = BTreeSet::new();
        // Root resolves the original episode and distinct content or grounding
        // references even when the live Hermes head has advanced past a turn.
        for turn in [
            &evidence.source_turn,
            &evidence.content_source,
            &evidence.grounding_source,
        ]
        .into_iter()
        .flatten()
        .filter(|turn| turn.conversation_id.starts_with("hermes-copy:"))
        {
            let imported = turn
                .imported
                .as_ref()
                .filter(|row| row.format == "hermes-source-copied-snapshot-v1")
                .ok_or(PROVENANCE_UNAVAILABLE)?;
            let session = &imported.conversation_id;
            let scope =
                HermesCopyScope::new(self.registry.profile_id().to_owned(), session.clone())
                    .map_err(|_| PROVENANCE_UNAVAILABLE)?;
            if scope.conversation_id() != turn.conversation_id
                || imported.message_id != turn.node_id
                || !matches!(&turn.availability, SourceAvailability::Available)
            {
                return Err(PROVENANCE_UNAVAILABLE);
            }
            if kind == OwnerKind::Phylactery && self.service.source_phy(session)? != Some(owner) {
                return Err(PROVENANCE_UNAVAILABLE);
            }
            let head = match self.heads.entry(session.clone()) {
                std::collections::btree_map::Entry::Occupied(entry) => entry.into_mut(),
                std::collections::btree_map::Entry::Vacant(entry) => {
                    if self
                        .service
                        .source_owner(session)
                        .map_err(|_| PROVENANCE_UNAVAILABLE)?
                        .or_else(|| self.registry.source_owner(session, true).ok())
                        != Some(source_owner)
                    {
                        return Err(PROVENANCE_UNAVAILABLE);
                    }
                    entry.insert(self.service.accepted_source_head(session, self.runtimes)?)
                }
            };
            digests.insert(head.as_ref().map_or_else(
                || hex(&imported.source_digest),
                |head| head.wire_digest.clone(),
            ));
        }
        Ok((digests.into_iter().collect(), source_principal_id))
    }
}

fn memory_id(value: &str) -> Result<MemoryId, HttpError> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(PROVENANCE_UNAVAILABLE);
    }
    let mut bytes = [0; 32];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .map_err(|_| PROVENANCE_UNAVAILABLE)?;
    }
    Ok(MemoryId(bytes))
}
