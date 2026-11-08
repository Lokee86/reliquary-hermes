mod support;

use reliquary_hermes_host::{ReturnOutcome, SelectedReturn};
use reliquary_memory::{ProductErrorKind, RetrievalMode, SearchOptions};
use std::fs;
use support::{Fixture, PROJECT, TOKEN};

#[test]
fn selected_return_commits_once_and_reopen_suppresses_duplicate_return() {
    let fixture = Fixture::new();
    let mounted = fixture.mount();
    fixture.seed(&mounted);
    let unchanged = fixture.rel_len();

    let search = mounted
        .instance
        .search(mounted.owner, "lantern", SearchOptions::default(), None)
        .unwrap();
    assert_eq!(search.memories.len(), 2);
    let inspect = mounted
        .instance
        .begin_retrieval(mounted.owner, "dashboard-preview", RetrievalMode::Inspect)
        .unwrap();
    let inspected = mounted
        .instance
        .memory_query(&inspect, "lantern", &fixture.runtime)
        .unwrap();
    assert!(inspected.prepared.is_none());
    let inspected = inspected.preview.unwrap();
    assert_eq!(inspected.memories.len(), 1);
    assert_eq!(inspected.memories[0].content, PROJECT);
    assert_eq!(fixture.rel_len(), unchanged);

    let turn = mounted
        .instance
        .begin_retrieval(mounted.owner, "hermes-turn", RetrievalMode::Deliver)
        .unwrap();
    let prepared = mounted
        .instance
        .memory_query(&turn, "lantern", &fixture.runtime)
        .unwrap()
        .prepared
        .unwrap();
    let stable_id = prepared.stable_id().to_owned();
    let expected = mounted
        .instance
        .preview_retrieval(&turn, &prepared)
        .unwrap();
    assert_eq!(expected.memories, inspected.memories);
    assert_eq!(fixture.rel_len(), unchanged);

    let boundary =
        SelectedReturn::new(&mounted.admission, &mounted.instance, &turn, &prepared).unwrap();
    assert_eq!(fixture.rel_len(), unchanged);
    let (first, second) = std::thread::scope(|scope| {
        let other = scope.spawn(|| boundary.return_selected().unwrap());
        let here = boundary.return_selected().unwrap();
        (here, other.join().unwrap())
    });
    match (first, second) {
        (
            ReturnOutcome::Returned {
                delivery_id,
                selection,
            },
            ReturnOutcome::AlreadyRecorded,
        )
        | (
            ReturnOutcome::AlreadyRecorded,
            ReturnOutcome::Returned {
                delivery_id,
                selection,
            },
        ) => {
            assert_eq!(delivery_id, stable_id);
            assert_eq!(selection, &expected);
        }
        _ => panic!("concurrent returns did not record exactly once"),
    }
    let accepted = fixture.rel_len();
    assert!(accepted > unchanged);
    assert!(matches!(
        boundary.return_selected().unwrap(),
        ReturnOutcome::AlreadyRecorded
    ));
    assert_eq!(fixture.rel_len(), accepted);
    drop(boundary);
    drop(turn);
    drop(mounted);

    let accepted_bytes = fs::read(&fixture.rel_path).unwrap();
    let reopened = fixture.mount();
    let turn = reopened
        .instance
        .begin_retrieval(reopened.owner, "hermes-turn", RetrievalMode::Deliver)
        .unwrap();
    let replay = reopened
        .instance
        .memory_query(&turn, "lantern", &fixture.runtime)
        .unwrap()
        .prepared
        .unwrap();
    assert_eq!(replay.stable_id(), stable_id);
    let boundary =
        SelectedReturn::new(&reopened.admission, &reopened.instance, &turn, &replay).unwrap();
    assert!(matches!(
        boundary.return_selected().unwrap(),
        ReturnOutcome::AlreadyRecorded
    ));
    assert_eq!(fixture.rel_len(), accepted);
    drop(boundary);
    drop(turn);
    drop(reopened);
    assert_eq!(fs::read(&fixture.rel_path).unwrap(), accepted_bytes);
}

#[test]
fn revoked_return_leaves_the_owner_unchanged() {
    let fixture = Fixture::new();
    let mounted = fixture.mount();
    fixture.seed(&mounted);
    let unchanged = fixture.rel_len();
    let turn = mounted
        .instance
        .begin_retrieval(mounted.owner, "revoked-turn", RetrievalMode::Deliver)
        .unwrap();
    let prepared = mounted
        .instance
        .memory_query(&turn, "lantern", &fixture.runtime)
        .unwrap()
        .prepared
        .unwrap();
    let boundary =
        SelectedReturn::new(&mounted.admission, &mounted.instance, &turn, &prepared).unwrap();
    mounted.control.revoke(TOKEN).unwrap();
    assert_eq!(
        boundary.return_selected().err().unwrap().kind(),
        ProductErrorKind::Revoked
    );
    assert_eq!(fixture.rel_len(), unchanged);
}

#[test]
fn truncated_preview_cannot_be_returned_as_the_exact_selection() {
    let fixture = Fixture::new();
    let mounted = fixture.mount();
    mounted
        .instance
        .workspace_management(mounted.owner)
        .unwrap()
        .create_memory(
            "Overflow note".into(),
            "Overflow ".repeat(140),
            "fact".into(),
            "note".into(),
            1,
        )
        .unwrap();
    let unchanged = fixture.rel_len();
    let turn = mounted
        .instance
        .begin_retrieval(mounted.owner, "overflow-turn", RetrievalMode::Deliver)
        .unwrap();
    let prepared = mounted
        .instance
        .memory_query(&turn, "overflow", &fixture.runtime)
        .unwrap()
        .prepared
        .unwrap();
    let preview = mounted
        .instance
        .preview_retrieval(&turn, &prepared)
        .unwrap();
    assert!(preview.truncated);
    assert_eq!(
        SelectedReturn::new(&mounted.admission, &mounted.instance, &turn, &prepared)
            .err()
            .unwrap()
            .kind(),
        ProductErrorKind::Unavailable
    );
    mounted.instance.cancel_retrieval(&turn).unwrap();
    assert_eq!(fixture.rel_len(), unchanged);
}
