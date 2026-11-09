use super::*;

const TOKEN: &str = "registry-test-profile-credential-value";
const NEW_TOKEN: &str = "registry-test-replacement-credential-value";

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
        let main_id = Rel::create(&main, OwnerScope::Unspecified)
            .unwrap()
            .owner_id();
        let project = directory.path().join("project.rel");
        let project_id = Rel::create(&project, OwnerScope::Project)
            .unwrap()
            .owner_id();
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
        let general = registry.bind_session("general-session").unwrap();
        let project = registry.bind_session("project-session").unwrap();
        assert_eq!(general.rel_id, fixture.main_id.to_string());
        assert_eq!(project.rel_id, fixture.project_id.to_string());
        assert_eq!(general.user_id, fixture.phy_id.to_string());
        assert_eq!(project.user_id, general.user_id);
        assert_eq!(registry.bind_session("project-session").unwrap(), project);
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
    assert_eq!(reopened.bind_session("general-session").unwrap(), general);
    assert_eq!(reopened.bind_session("project-session").unwrap(), project);
    assert!(reopened.authenticate(TOKEN).is_err());
    assert!(reopened.authenticate(NEW_TOKEN).is_ok());
}

#[test]
fn dashboard_topology_is_read_only_and_rejects_unbound_unknown_sessions() {
    let fixture = Fixture::new();
    let registry = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
    let instance = registry.authenticate(TOKEN).unwrap();
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
    Rel::create(&second_rel, OwnerScope::Unspecified).unwrap();
    let mut config = fixture.config();
    config.profile_id = "profile-two".into();
    config.principal_id = "principal-two".into();
    config.main_rel = second_rel;
    config.projects.clear();
    config.session_projects.clear();
    let mut second = Registry::open(config, &second_state, NEW_TOKEN).unwrap();
    let first_binding = first.bind_session("same-session").unwrap();
    let second_binding = second.bind_session("same-session").unwrap();
    assert_ne!(first_binding.rel_id, second_binding.rel_id);
    assert_eq!(first_binding.user_id, second_binding.user_id);
}

#[test]
fn invalid_owner_and_changed_route_do_not_create_fallback_bindings() {
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
        .bind_session("general-session")
        .unwrap();
    let mut config = fixture.config();
    config
        .session_projects
        .insert("general-session".into(), "demo".into());
    let mut registry = Registry::open(config, &fixture.state, TOKEN).unwrap();
    assert_eq!(
        registry.bind_session("general-session").unwrap_err().code(),
        "session_binding_changed"
    );
    assert_eq!(
        registry.bind_session("../foreign").unwrap_err().code(),
        "invalid_session"
    );
    drop(registry);
    let mut reopened = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
    assert_eq!(reopened.bind_session("general-session").unwrap(), original);
}

#[test]
fn malformed_and_missing_durable_state_fail_closed() {
    let fixture = Fixture::new();
    let mut registry = Registry::open(fixture.config(), &fixture.state, TOKEN).unwrap();
    registry.bind_session("general-session").unwrap();
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
