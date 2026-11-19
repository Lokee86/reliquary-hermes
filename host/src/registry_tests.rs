use super::*;

const TOKEN: &str = "registry-test-profile-credential-value";
const NEW_TOKEN: &str = "registry-test-replacement-credential-value";

#[path = "../tests/support/legacy_rel.rs"]
mod legacy_rel;

struct Fixture {
    _directory: tempfile::TempDir,
    state: PathBuf,
    main: PathBuf,
    project: PathBuf,
    phy: PathBuf,
    main_id: OwnerId,
    project_id: OwnerId,
    phy_id: OwnerId,
}

impl Fixture {
    fn new() -> Self {
        let scratch = Path::new(env!("CARGO_MANIFEST_DIR")).join(".test-tmp");
        std::fs::create_dir_all(&scratch).unwrap();
        let directory = tempfile::tempdir_in(&scratch).unwrap();
        let state = directory.path().join("state");
        std::fs::create_dir(&state).unwrap();
        let main = directory.path().join("main.rel");
        let main_id = Rel::create(&main).unwrap().owner_id();
        let project = directory.path().join("project.rel");
        let project_id = Rel::create(&project).unwrap().owner_id();
        let phy = directory.path().join("human.phy");
        let phy_id = Phylactery::create(&phy).unwrap().owner_id();
        Self {
            _directory: directory,
            state,
            main,
            project,
            phy,
            main_id,
            project_id,
            phy_id,
        }
    }

    fn config(&self) -> OwnerConfig {
        OwnerConfig {
            profile_id: "profile-one".into(),
            principal_id: "principal-one".into(),
            main_rel: self.main.clone(),
            projects: BTreeMap::from([("demo".into(), self.project.clone())]),
            active_phy: self.phy.clone(),
            session_projects: BTreeMap::from([("project-session".into(), "demo".into())]),
        }
    }
}

#[test]
fn routes_persist_across_restart_and_keep_the_active_phy_independent() {
    let fixture = Fixture::new();
    let (general, project) = {
        let mut registry = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
        assert_eq!(registry.profile_id(), "profile-one");
        assert_eq!(registry.principal_id(), "principal-one");
        assert_eq!(
            registry.authenticate(NEW_TOKEN).err().unwrap().code(),
            "denied"
        );
        let client = registry.authenticate(TOKEN).unwrap();
        assert_eq!(client.principal(), "principal-one");
        assert!(!registry.is_bound("general-session").unwrap());
        assert_eq!(
            registry
                .owner_status(&client, "general-session")
                .unwrap_err()
                .code(),
            "unbound_session"
        );
        let general = registry.bind_session("general-session", None).unwrap();
        let project = registry
            .bind_session("project-session", Some("demo"))
            .unwrap();
        assert_eq!(general.rel_id, fixture.main_id.to_string());
        assert_eq!(project.rel_id, fixture.project_id.to_string());
        assert_eq!(general.user_id, fixture.phy_id.to_string());
        assert_eq!(project.user_id, general.user_id);
        assert_eq!(
            registry.bind_session("project-session", None).unwrap(),
            project
        );
        let status = registry.owner_status(&client, "project-session").unwrap();
        assert_eq!(
            serde_json::to_value(status).unwrap(),
            serde_json::json!({"worker_state": "complete", "pending_jobs": 0})
        );
        let topology: Topology = store::read(
            &fixture.state.join("topology-v1.json"),
            store::MAX_TOPOLOGY_BYTES,
        )
        .unwrap()
        .unwrap();
        assert_eq!(topology.projects["demo"].parent_id, fixture.main_id);
        (general, project)
    };
    let mut reopened = Registry::open(fixture.config(), &fixture.state, NEW_TOKEN).unwrap();
    assert!(reopened.is_bound("general-session").unwrap());
    assert!(reopened.is_bound("project-session").unwrap());
    assert_eq!(
        reopened.bind_session("general-session", None).unwrap(),
        general
    );
    assert_eq!(
        reopened.bind_session("project-session", None).unwrap(),
        project
    );
    assert!(reopened.authenticate(TOKEN).is_err());
    assert!(reopened.authenticate(NEW_TOKEN).is_ok());
}

#[test]
fn legacy_rel_headers_mount_in_both_roles_and_preserve_routes_on_reopen() {
    for (main, project) in legacy_rel::role_pairs() {
        let fixture = Fixture::new();
        let main_bytes = main.bytes();
        let project_bytes = project.bytes();
        std::fs::write(&fixture.main, &main_bytes).unwrap();
        std::fs::write(&fixture.project, &project_bytes).unwrap();

        let (general, dedicated) = {
            let mut registry = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
            let general = registry.bind_session("legacy-general", None).unwrap();
            let dedicated = registry
                .bind_session("legacy-project", Some("demo"))
                .unwrap();
            assert_eq!(general.rel_id, main.owner_id, "General: {}", main.scope);
            assert_eq!(
                dedicated.rel_id, project.owner_id,
                "project: {}",
                project.scope
            );
            assert_eq!(general.user_id, fixture.phy_id.to_string());
            assert_eq!(dedicated.user_id, general.user_id);
            (general, dedicated)
        };
        {
            let mut registry = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
            assert_eq!(
                registry.bind_session("legacy-general", None).unwrap(),
                general
            );
            assert_eq!(
                registry.bind_session("legacy-project", None).unwrap(),
                dedicated
            );
        }
        assert_eq!(std::fs::read(&fixture.main).unwrap(), main_bytes);
        assert_eq!(std::fs::read(&fixture.project).unwrap(), project_bytes);
    }
}

#[test]
fn dashboard_topology_is_read_only_and_rejects_unbound_unknown_sessions() {
    let fixture = Fixture::new();
    let mut registry = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
    let instance = registry.authenticate(TOKEN).unwrap();
    assert_eq!(
        registry
            .dashboard_topology(&instance, Some("project-session"))
            .unwrap_err()
            .code(),
        "unknown_session"
    );
    registry
        .bind_session("project-session", Some("demo"))
        .unwrap();
    let configured = registry
        .dashboard_topology(&instance, Some("project-session"))
        .unwrap();
    assert_eq!(configured["owners"].as_array().unwrap().len(), 3);
    assert_eq!(configured["active_phy_id"], fixture.phy_id.to_string());
    assert_eq!(
        configured["session_owner_id"],
        fixture.project_id.to_string()
    );
    let main = &configured["owners"][0];
    assert_eq!(main["owner_id"], fixture.main_id.to_string());
    assert_eq!(main["owner_kind"], "REL");
    assert_eq!(main["capabilities"]["view"], true);
    assert_eq!(main["capabilities"]["manage"], true);
    assert_eq!(main["capabilities"]["memory_create"], true);
    let phy = &configured["owners"][2];
    assert_eq!(phy["owner_id"], fixture.phy_id.to_string());
    assert_eq!(phy["capabilities"]["view"], true);
    assert_eq!(phy["capabilities"]["manage"], false);
    assert_eq!(phy["capabilities"]["memory_create"], false);
    assert_eq!(
        registry.dashboard_actor().principal(),
        fixture.phy_id.to_string()
    );
    let root_cut = instance
        .inspect_owner(
            fixture.main_id,
            OwnerKind::Rel,
            &InspectionQuery::MemorySummaries(MemoryListFilters::default()),
            None,
            1,
        )
        .unwrap()
        .cut;
    let expected_generation =
        u128::from_le_bytes(root_cut.generation[..16].try_into().unwrap()).to_string();
    let expected_digest = Sha256::digest(serde_json::to_vec(&root_cut).unwrap());
    assert_eq!(main["generation"], expected_generation);
    assert_eq!(main["cut"], crate::service_http::hex(&expected_digest));
    let before = std::fs::read_dir(fixture.state.join("sessions-v1"))
        .unwrap()
        .count();
    assert_eq!(
        registry
            .dashboard_topology(&instance, Some("unbound-session"))
            .unwrap_err()
            .code(),
        "unknown_session"
    );
    let after = std::fs::read_dir(fixture.state.join("sessions-v1"))
        .unwrap()
        .count();
    assert_eq!(before, after);
    assert_eq!(
        registry.dashboard_topology(&instance, None).unwrap()["session_id"],
        serde_json::Value::Null
    );
}

#[test]
fn separate_profiles_can_share_the_phy_but_cannot_share_the_rel_writer() {
    let fixture = Fixture::new();
    let mut first = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
    assert_eq!(
        Registry::open(fixture.config(), &fixture.state, TOKEN)
            .err()
            .unwrap()
            .code(),
        "service_lease_conflict"
    );
    let second_state = fixture.state.with_file_name("second");
    std::fs::create_dir(&second_state).unwrap();
    assert_eq!(
        Registry::open(fixture.config(), &second_state, TOKEN)
            .err()
            .unwrap()
            .code(),
        "owner_writer_conflict"
    );
    assert!(!second_state.join("topology-v1.json").exists());

    let second_rel = fixture.main.with_file_name("second.rel");
    Rel::create(&second_rel).unwrap();
    let mut config = fixture.config();
    config.profile_id = "profile-two".into();
    config.principal_id = "principal-two".into();
    config.main_rel = second_rel;
    config.projects.clear();
    config.session_projects.clear();
    let mut second = Registry::open(config, &second_state, NEW_TOKEN).unwrap();
    let first_binding = first.bind_session("same-session", None).unwrap();
    let second_binding = second.bind_session("same-session", None).unwrap();
    assert_ne!(first_binding.rel_id, second_binding.rel_id);
    assert_eq!(first_binding.user_id, second_binding.user_id);
}

#[test]
fn invalid_owner_is_rejected_and_accepted_route_wins_over_new_attribution() {
    let fixture = Fixture::new();
    let mut config = fixture.config();
    config.active_phy = fixture.main.clone();
    assert_eq!(
        Registry::open(config, &fixture.state, TOKEN)
            .err()
            .unwrap()
            .code(),
        "invalid_owner"
    );
    assert!(!fixture.state.join("topology-v1.json").exists());
    let original = Registry::open(fixture.config(), &fixture.state, TOKEN)
        .unwrap()
        .bind_session("general-session", None)
        .unwrap();
    let mut config = fixture.config();
    config
        .session_projects
        .insert("general-session".into(), "demo".into());
    let mut registry = Registry::open(config, &fixture.state, TOKEN).unwrap();
    assert_eq!(
        registry
            .bind_session("general-session", Some("demo"))
            .unwrap(),
        original
    );
    // A persisted legacy hint does not supply authoritative metadata for a new session.
    let unattributed = registry.bind_session("project-session", None).unwrap();
    assert_eq!(unattributed.rel_id, fixture.main_id.to_string());
    assert_eq!(
        registry
            .bind_session("../foreign", None)
            .unwrap_err()
            .code(),
        "invalid_session"
    );
    drop(registry);
    let mut reopened = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
    assert_eq!(
        reopened.bind_session("general-session", None).unwrap(),
        original
    );
}

#[test]
fn review_adds_project_without_retargeting_existing_fallback() {
    let fixture = Fixture::new();
    let second_path = fixture.project.with_file_name("second.rel");
    let second_id = Rel::create(&second_path).unwrap().owner_id();
    let (fallback, dedicated, new_session) = {
        let mut registry = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
        let fallback = registry
            .bind_session("existing-fallback", Some("second"))
            .unwrap();
        let dedicated = registry
            .bind_session("existing-dedicated", Some("demo"))
            .unwrap();
        let old_route = std::fs::read(registry.session_path("existing-fallback")).unwrap();
        let review = registry
            .review_switch(SwitchChanges {
                main_rel: None,
                active_phy: None,
                projects: BTreeMap::from([("second".into(), second_path.clone())]),
            })
            .unwrap();
        assert_eq!(registry.apply_switch(review).unwrap().generation, 1);
        assert_eq!(
            registry
                .bind_session("existing-fallback", Some("second"))
                .unwrap(),
            fallback
        );
        assert_eq!(
            registry
                .bind_session("existing-dedicated", Some("second"))
                .unwrap(),
            dedicated
        );
        let new_session = registry
            .bind_session("new-project-session", Some("second"))
            .unwrap();
        assert_eq!(new_session.rel_id, second_id.to_string());
        assert_eq!(
            registry.source_owner("new-project-session", true).unwrap(),
            second_id
        );
        assert_eq!(
            std::fs::read(registry.session_path("existing-fallback")).unwrap(),
            old_route
        );
        (fallback, dedicated, new_session)
    };
    let substitute_path = fixture.project.with_file_name("different-bootstrap.rel");
    Rel::create(&substitute_path).unwrap();
    let mut config = fixture.config();
    config.main_rel = substitute_path.clone();
    config.projects.insert("second".into(), substitute_path);
    let mut restarted = Registry::open(config, &fixture.state, TOKEN).unwrap();
    assert_eq!(
        restarted.bind_session("existing-fallback", None).unwrap(),
        fallback
    );
    assert_eq!(
        restarted.bind_session("existing-dedicated", None).unwrap(),
        dedicated
    );
    assert_eq!(
        restarted.bind_session("new-project-session", None).unwrap(),
        new_session
    );
    assert_eq!(
        restarted.bind_session("fresh", None).unwrap().rel_id,
        fixture.main_id.to_string()
    );
}

#[test]
fn switches_all_roles_and_reopens_pinned_legacy_and_v2_sessions() {
    let fixture = Fixture::new();
    let topology_path = fixture.state.join(TOPOLOGY_FILE);
    let old = LegacyTopology {
        version: 1,
        profile_id: "profile-one".into(),
        principal_id: "principal-one".into(),
        main_rel: fixture.main_id,
        active_phy: fixture.phy_id,
        projects: BTreeMap::from([(
            "demo".into(),
            ProjectOwner {
                parent_id: fixture.main_id,
                rel_id: fixture.project_id,
            },
        )]),
    };
    store::publish(&topology_path, &old).unwrap();
    assert!(committed_switch_status(&fixture.state).unwrap().is_none());
    let routes = fixture.state.join("sessions-v1");
    std::fs::create_dir(&routes).unwrap();
    let legacy = [
        ("legacy-general", None, fixture.main_id),
        ("legacy-dedicated", Some("demo"), fixture.project_id),
    ]
    .map(|(session, project, rel)| {
        let file = routes.join(format!("{:x}.json", Sha256::digest(session.as_bytes())));
        store::publish(
            &file,
            &json!({"session_id": session, "project_id": project, "rel_id": rel}),
        )
        .unwrap();
        (session, file.clone(), std::fs::read(file).unwrap(), rel)
    });

    let next_main = fixture.main.with_file_name("next-main.rel");
    let next_project = fixture.project.with_file_name("next-project.rel");
    let next_phy = fixture.phy.with_file_name("next-person.phy");
    let main_id = Rel::create(&next_main).unwrap().owner_id();
    let project_id = Rel::create(&next_project).unwrap().owner_id();
    let phy_id = Phylactery::create(&next_phy).unwrap().owner_id();

    let old_phy_file = std::fs::read(&fixture.phy).unwrap();
    let old_rel_file = std::fs::read(&fixture.main).unwrap();
    {
        let mut registry = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
        let first_instance = registry.instance().unwrap();
        assert_eq!(registry.switch_status().unwrap().generation, 0);
        let review = registry
            .review_switch(SwitchChanges {
                main_rel: Some(next_main.clone()),
                active_phy: None,
                projects: BTreeMap::from([("demo".into(), next_project.clone())]),
            })
            .unwrap();
        assert_eq!(registry.apply_switch(review).unwrap().generation, 1);
        assert_eq!(
            registry.bind_session("fresh-general", None).unwrap().rel_id,
            main_id.to_string()
        );
        assert_eq!(
            registry
                .bind_session("fresh-project", Some("demo"))
                .unwrap()
                .rel_id,
            project_id.to_string()
        );
        for (session, path, original, rel) in &legacy {
            let binding = registry.bind_session(session, None).unwrap();
            assert_eq!(binding.rel_id, rel.to_string());
            assert_eq!(binding.user_id, fixture.phy_id.to_string());
            assert_eq!(&std::fs::read(path).unwrap(), original);
            let provider = registry.instance().unwrap();
            let topology = registry
                .dashboard_topology(&provider, Some(session))
                .unwrap();
            assert_eq!(topology["session_owner_id"], rel.to_string());
            assert_eq!(topology["owners"][2]["display_label"], "Session REL");
            assert_eq!(
                registry
                    .dashboard_scope(
                        "profile-one",
                        &fixture.phy_id.to_string(),
                        &rel.to_string(),
                        Some(session)
                    )
                    .unwrap()
                    .0,
                *rel,
            );
            assert!(
                registry
                    .dashboard_scope(
                        "profile-one",
                        &fixture.phy_id.to_string(),
                        &rel.to_string(),
                        None
                    )
                    .is_err()
            );
        }
        assert!(
            registry
                .configured_source_owner(&fixture.main_id.to_string())
                .is_err()
        );
        assert_eq!(
            registry
                .retained_source_owner(&fixture.main_id.to_string())
                .unwrap(),
            fixture.main_id
        );
        assert!(inspect_dashboard_cut(&first_instance, fixture.main_id, OwnerKind::Rel).is_err());

        let review = registry
            .review_switch(SwitchChanges {
                main_rel: None,
                active_phy: Some(next_phy),
                projects: BTreeMap::new(),
            })
            .unwrap();
        assert_eq!(registry.apply_switch(review).unwrap().generation, 2);
        assert_eq!(registry.active_phy(), phy_id);
        assert_eq!(registry.legacy_phy(), fixture.phy_id);
        assert_eq!(
            registry.bind_session("other-person", None).unwrap().user_id,
            phy_id.to_string()
        );
        for (session, _, _, _) in &legacy {
            assert!(registry.is_bound(session).unwrap());
            assert_eq!(
                registry.bind_session(session, None).unwrap_err().code(),
                "session_phy_inactive"
            );
            assert_eq!(
                registry.source_owner(session, false).unwrap_err().code(),
                "session_phy_inactive"
            );
            assert_eq!(
                registry
                    .dashboard_topology(&registry.instance().unwrap(), Some(session))
                    .unwrap_err()
                    .code(),
                "session_phy_inactive"
            );
        }
        let current = registry.instance().unwrap();
        assert!(inspect_dashboard_cut(&current, fixture.phy_id, OwnerKind::Phylactery).is_err());
        assert!(inspect_dashboard_cut(&current, phy_id, OwnerKind::Phylactery).is_ok());
    }
    let offline = committed_switch_status(&fixture.state).unwrap().unwrap();
    assert_eq!(offline.generation, 2);
    let mut registry = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
    assert_eq!(registry.active_phy(), phy_id);
    assert_eq!(
        registry
            .bind_session("fresh-general", None)
            .unwrap_err()
            .code(),
        "session_phy_inactive"
    );
    let review = registry
        .review_switch(SwitchChanges {
            main_rel: None,
            active_phy: Some(fixture.phy.clone()),
            projects: BTreeMap::new(),
        })
        .unwrap();
    assert_eq!(registry.apply_switch(review).unwrap().generation, 3);
    assert_eq!(
        registry.bind_session("fresh-general", None).unwrap().rel_id,
        main_id.to_string()
    );
    assert_eq!(
        registry
            .bind_session("other-person", None)
            .unwrap_err()
            .code(),
        "session_phy_inactive"
    );
    for (session, path, original, rel) in &legacy {
        let binding = registry.bind_session(session, Some("demo")).unwrap();
        assert_eq!(binding.rel_id, rel.to_string());
        assert_eq!(binding.user_id, fixture.phy_id.to_string());
        assert_eq!(&std::fs::read(path).unwrap(), original);
    }
    drop(registry);
    assert_eq!(std::fs::read(&fixture.phy).unwrap(), old_phy_file);
    assert_eq!(std::fs::read(&fixture.main).unwrap(), old_rel_file);

    std::fs::remove_file(&fixture.main).unwrap();
    let mut registry = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
    assert_eq!(
        registry
            .bind_session("legacy-general", None)
            .unwrap_err()
            .code(),
        "bound_owner_unavailable"
    );
    assert_eq!(
        registry
            .bind_session("legacy-dedicated", None)
            .unwrap()
            .rel_id,
        fixture.project_id.to_string()
    );
    assert_eq!(
        registry.bind_session("after-restart", None).unwrap().rel_id,
        main_id.to_string()
    );
}

#[test]
fn failed_switch_releases_staging_and_stale_review_cannot_overwrite() {
    let fixture = Fixture::new();
    let mut registry = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
    let held = registry.instance().unwrap();
    let backup = std::fs::read(&registry.topology_path).unwrap();
    let next = fixture.main.with_file_name("next-main.rel");
    let blocked = fixture.project.with_file_name("blocked.rel");
    let next_owner = Rel::create(&next).unwrap();
    let blocked_owner = Rel::create(&blocked).unwrap();
    let reviewed_all = registry
        .review_switch(SwitchChanges {
            main_rel: Some(next.clone()),
            active_phy: None,
            projects: BTreeMap::from([("demo".into(), blocked)]),
        })
        .unwrap();
    let other = Gateway::new();
    other.mount_rel(&blocked_owner, true).unwrap();
    assert_eq!(
        registry.apply_switch(reviewed_all).unwrap_err().code(),
        "owner_writer_conflict"
    );
    assert_eq!(registry.switch_status().unwrap().generation, 0);
    assert_eq!(std::fs::read(&registry.topology_path).unwrap(), backup);
    assert!(inspect_dashboard_cut(&held, fixture.main_id, OwnerKind::Rel).is_ok());
    // The first writer was staged before the second mount failed.
    assert_eq!(
        other.mount_rel(&next_owner, true).unwrap(),
        next_owner.owner_id()
    );
    drop(other);

    let no_change = || SwitchChanges {
        main_rel: Some(fixture.main.clone()),
        active_phy: None,
        projects: BTreeMap::new(),
    };
    let stale = registry.review_switch(no_change()).unwrap();
    let no_op = registry.review_switch(no_change()).unwrap();
    assert_eq!(registry.apply_switch(no_op).unwrap().generation, 0);
    assert_eq!(std::fs::read(&registry.topology_path).unwrap(), backup);

    let review = registry
        .review_switch(SwitchChanges {
            main_rel: Some(next),
            active_phy: None,
            projects: BTreeMap::new(),
        })
        .unwrap();
    assert_eq!(registry.apply_switch(review).unwrap().generation, 1);
    assert_eq!(
        registry.apply_switch(stale).unwrap_err().code(),
        "owner_switch_stale"
    );

    let uncommitted = fixture.phy.with_file_name("uncommitted.phy");
    let uncommitted_owner = Phylactery::create(&uncommitted).unwrap();
    let review = registry
        .review_switch(SwitchChanges {
            main_rel: None,
            active_phy: Some(uncommitted),
            projects: BTreeMap::new(),
        })
        .unwrap();
    let committed = std::fs::read(&registry.topology_path).unwrap();
    // Simulate interruption of accepted-state evidence before publication.
    // The staged PHY must not be exposed or a missing record repaired from RAM.
    std::fs::write(&registry.topology_path, b"interrupted").unwrap();
    assert_eq!(
        registry.apply_switch(review).unwrap_err().code(),
        "owner_switch_recovery_required"
    );
    assert_eq!(
        registry.bind_session("fenced", None).unwrap_err().code(),
        "owner_switch_recovery_required"
    );
    assert_eq!(
        std::fs::read(&registry.topology_path).unwrap(),
        b"interrupted"
    );
    assert_eq!(
        registry
            .gateway
            .mount_phylactery(&uncommitted_owner, false)
            .unwrap(),
        uncommitted_owner.owner_id(),
    );

    std::fs::write(&registry.topology_path, committed).unwrap();
    drop(held);
    drop(registry);
    let mut restarted = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
    assert_eq!(
        restarted.bind_session("recovered", None).unwrap().rel_id,
        next_owner.owner_id().to_string()
    );
    assert_eq!(restarted.active_phy(), fixture.phy_id);
}

#[test]
fn malformed_and_missing_durable_state_fail_closed() {
    let fixture = Fixture::new();
    let mut registry = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
    registry.bind_session("general-session", None).unwrap();
    let path = registry.session_path("general-session");
    std::fs::write(&path, b"truncated").unwrap();
    assert_eq!(
        registry.is_bound("general-session").unwrap_err().code(),
        "state_corrupt"
    );
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert_eq!(
        registry.is_bound("general-session").unwrap_err().code(),
        "state_corrupt"
    );
    drop(registry);
    std::fs::remove_dir(path).unwrap();
    std::fs::remove_dir(fixture.state.join("sessions-v1")).unwrap();
    assert_eq!(
        Registry::open(fixture.config(), &fixture.state, TOKEN)
            .err()
            .unwrap()
            .code(),
        "state_corrupt"
    );
    let duplicate_keys = r#"{
        "profile_id":"profile-one","principal_id":"principal-one","main_rel":"main.rel",
        "projects":{"demo":"first.rel","demo":"second.rel"},"active_phy":"human.phy"
    }"#;
    assert!(serde_json::from_str::<OwnerConfig>(duplicate_keys).is_err());
}

#[test]
fn manual_source_destination_is_limited_to_configured_rels() {
    let fixture = Fixture::new();
    let registry = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
    assert_eq!(
        registry
            .configured_source_owner(&fixture.main_id.to_string())
            .unwrap(),
        fixture.main_id
    );
    assert_eq!(
        registry
            .configured_source_owner(&fixture.project_id.to_string())
            .unwrap(),
        fixture.project_id
    );
    assert_eq!(
        registry
            .configured_source_owner(&fixture.phy_id.to_string())
            .unwrap_err()
            .code(),
        "unconfigured_source_owner"
    );
}
