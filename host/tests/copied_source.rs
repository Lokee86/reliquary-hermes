mod support;

use reliquary_memory::{
    HermesCopiedAuthor, HermesCopiedMessage, HermesCopiedRole, HermesCopiedSnapshot,
    HermesCopyScope, InspectionItem, InspectionQuery, NativeImportPlan, NativeImportState,
    OwnerKind, ProcessOptions, ProcessingState, ProductErrorKind, SourceAvailability, SourceTurn,
};
use std::fs;
use support::{Fixture, Mounted, OTHER_TOKEN, PROJECT};

const SESSION: &str = "session-1";
const MESSAGE: &str = "accepted";
const TIME_NS: i64 = 1_000_000_000_125;

fn scope(profile: &str) -> HermesCopyScope {
    HermesCopyScope::new(profile.into(), SESSION.into()).unwrap()
}

fn snapshot(scope: &HermesCopyScope) -> HermesCopiedSnapshot {
    HermesCopiedSnapshot {
        scope: scope.clone(),
        branch_id: None,
        source_revision: None,
        messages: vec![HermesCopiedMessage {
            message_uid: MESSAGE.into(),
            role: HermesCopiedRole::User,
            timestamp_ns: TIME_NS,
            content: PROJECT.into(),
            author: Some(HermesCopiedAuthor {
                id: Some("source-actor".into()),
                is_bot: Some(false),
            }),
        }],
    }
}

fn inspect(mounted: &Mounted, scope: &HermesCopyScope) -> SourceTurn {
    let page = mounted
        .instance
        .inspect_owner(
            mounted.owner,
            OwnerKind::Rel,
            &InspectionQuery::SourceTurn {
                conversation: scope.conversation_id(),
                node: MESSAGE.into(),
            },
            None,
            1,
        )
        .unwrap();
    let [InspectionItem::Turn(turn)] = page.items.as_slice() else {
        panic!("expected one exact copied source");
    };
    turn.clone()
}

#[test]
fn copied_source_reopens_with_original_identity_and_terminal_replay_fence() {
    let fixture = Fixture::with_private_fixture(false);
    let mounted = fixture.mount();
    let scope = scope("profile-a");
    let plan = NativeImportPlan::from_hermes_copy(snapshot(&scope)).unwrap();
    let key = plan.source_sha256();
    let staged = mounted
        .instance
        .stage_native_import(mounted.owner, plan)
        .unwrap();
    let staged_len = fixture.rel_len();
    let replay = mounted
        .instance
        .stage_native_import(
            mounted.owner,
            NativeImportPlan::from_hermes_copy(snapshot(&scope)).unwrap(),
        )
        .unwrap();
    assert!(replay.already_staged);
    assert_eq!(replay.receipt_digest, staged.receipt_digest);
    assert_eq!(fixture.rel_len(), staged_len);

    let copied = inspect(&mounted, &scope);
    assert_eq!(copied.timestamp_ns, TIME_NS);
    assert_eq!(copied.node_id, MESSAGE);
    assert_eq!(copied.content.as_deref(), Some(PROJECT));
    assert_eq!(copied.principal_id, None);
    let source = copied.imported.unwrap();
    assert_eq!(source.format, "hermes-source-copied-snapshot-v1");
    assert!(source.namespace.starts_with("hermes/profile/profile-a/"));
    assert_eq!(source.conversation_id, SESSION);
    assert_eq!(source.message_id, MESSAGE);
    assert_eq!(source.source_branch_id, None);
    assert_eq!(source.source_digest, key);
    assert_eq!(source.receipt_digest, staged.receipt_digest);
    assert_eq!(
        source.source_author.unwrap().id.as_deref(),
        Some("source-actor")
    );

    let options = |destination| ProcessOptions {
        import_id: Some(staged.import_id.clone()),
        destination,
        max_episodes: 1,
    };
    assert_eq!(
        mounted
            .instance
            .process_and_drain(
                mounted.owner,
                &fixture.processing_runtime,
                options(Some(mounted.phy_owner)),
            )
            .unwrap_err()
            .kind(),
        ProductErrorKind::Conflict,
    );
    let report = mounted
        .instance
        .process_and_drain(mounted.owner, &fixture.processing_runtime, options(None))
        .unwrap();
    assert_eq!(report.state, ProcessingState::Ready, "{report:?}");
    assert_eq!(report.insomnia.rel_memories, 1);
    let status = mounted
        .instance
        .native_import_status(mounted.owner, &staged.import_id)
        .unwrap()
        .unwrap();
    assert_eq!(status.state, NativeImportState::Completed);

    let foreign = mounted.admission.authenticate(OTHER_TOKEN).unwrap();
    assert_eq!(
        foreign
            .tombstone_hermes_copy(mounted.owner, &scope, key)
            .unwrap_err()
            .kind(),
        ProductErrorKind::Conflict
    );
    let wrong_profile = HermesCopyScope::new("profile-b".into(), SESSION.into()).unwrap();
    assert_eq!(
        mounted
            .instance
            .tombstone_hermes_copy(mounted.owner, &wrong_profile, key)
            .unwrap_err()
            .kind(),
        ProductErrorKind::Conflict
    );
    assert!(
        mounted
            .instance
            .tombstone_hermes_copy(mounted.owner, &scope, key)
            .unwrap()
    );
    assert_eq!(inspect(&mounted, &scope).content, None);
    drop(foreign);
    drop(mounted);

    let terminal_bytes = fs::read(&fixture.rel_path).unwrap();
    let reopened = fixture.mount();
    let terminal = inspect(&reopened, &scope);
    assert_eq!(terminal.availability, SourceAvailability::Terminal);
    assert_eq!(terminal.content, None);
    assert_eq!(
        terminal.imported.unwrap().receipt_digest,
        staged.receipt_digest
    );
    assert!(
        !reopened
            .instance
            .tombstone_hermes_copy(reopened.owner, &scope, key)
            .unwrap()
    );
    assert_eq!(
        reopened
            .instance
            .stage_native_import(
                reopened.owner,
                NativeImportPlan::from_hermes_copy(snapshot(&scope)).unwrap(),
            )
            .unwrap_err()
            .kind(),
        ProductErrorKind::Conflict
    );
    drop(reopened);
    assert_eq!(fs::read(&fixture.rel_path).unwrap(), terminal_bytes);
}

#[test]
fn named_source_branch_and_revision_survive_normalization() {
    let fixture = Fixture::with_private_fixture(false);
    let mounted = fixture.mount();
    let scope = scope("profile-a");
    let mut source = snapshot(&scope);
    source.branch_id = Some("original-branch".into());
    source.source_revision = Some("original-revision".into());
    let plan = NativeImportPlan::from_hermes_copy(source).unwrap();
    mounted
        .instance
        .stage_native_import(mounted.owner, plan)
        .unwrap();
    let imported = inspect(&mounted, &scope).imported.unwrap();
    assert_eq!(
        imported.source_branch_id.as_deref(),
        Some("original-branch")
    );
    assert_eq!(
        imported.message_revision,
        "hermes-snapshot-revision:original-revision"
    );
}

#[test]
fn invalid_copied_ids_and_timestamps_fail_before_stage() {
    let scope = scope("profile-a");
    let mut invalid = snapshot(&scope);
    invalid.messages[0].timestamp_ns = -1;
    assert_eq!(
        NativeImportPlan::from_hermes_copy(invalid)
            .err()
            .unwrap()
            .kind(),
        ProductErrorKind::InvalidInput
    );
    let mut duplicate = snapshot(&scope);
    duplicate.messages.extend(snapshot(&scope).messages);
    assert_eq!(
        NativeImportPlan::from_hermes_copy(duplicate)
            .err()
            .unwrap()
            .kind(),
        ProductErrorKind::InvalidInput
    );
    assert!(HermesCopyScope::new("invalid/profile".into(), SESSION.into()).is_err());
}
