use reliquary_memory::{
    CredentialId, Gateway, OwnerScope, Phylactery, Rel, ReliquaryConfig, SecretString,
};
use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};

struct Fixture {
    scratch: tempfile::TempDir,
    state: PathBuf,
    main: PathBuf,
    phy: PathBuf,
    project: PathBuf,
    config: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let scratch = Path::new(env!("CARGO_MANIFEST_DIR")).join(".test-tmp");
        fs::create_dir_all(&scratch).unwrap();
        let scratch = tempfile::tempdir_in(scratch).unwrap();
        let state = scratch.path().join("profile").join("reliquary");
        let main = scratch.path().join("main.owner");
        let phy = scratch.path().join("person.owner");
        let project = scratch.path().join("project.owner");
        let config = scratch.path().join("processing.cfg");
        Rel::create(&main, OwnerScope::Organization).unwrap();
        Phylactery::create(&phy).unwrap();
        Rel::create(&project, OwnerScope::Project).unwrap();
        let mut processing = ReliquaryConfig::new_blank(&config);
        processing.add_api_key(
            CredentialId::new("fixture-key").unwrap(),
            SecretString::new("synthetic-setup-test-key").unwrap(),
        );
        processing.save().unwrap();
        Self {
            scratch,
            state,
            main,
            phy,
            project,
            config,
        }
    }

    fn request(&self) -> Value {
        json!({
            "owners": {
                "profile_id": "setup-profile",
                "principal_id": "setup-principal",
                "main_rel": self.main,
                "active_phy": self.phy,
                "projects": {"demo": self.project}
            },
            "config_path": self.config
        })
    }

    fn run(&self, request: &[u8]) -> Output {
        self.run_command("setup-validate", request)
    }

    fn run_command(&self, command: &str, request: &[u8]) -> Output {
        let mut child = Command::new(env!("CARGO_BIN_EXE_reliquary-hermes-host"))
            .args([command, "--state-dir"])
            .arg(&self.state)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(request).unwrap();
        child.wait_with_output().unwrap()
    }

    fn report(&self, request: &Value) -> Value {
        let output = self.run(&serde_json::to_vec(request).unwrap());
        assert!(output.status.success(), "{:?}", output.stderr);
        assert!(output.stderr.is_empty());
        serde_json::from_slice(&output.stdout).unwrap()
    }

    fn create(&self, role: &str, path: &Path) -> Output {
        self.run_command(
            "setup-create",
            &serde_json::to_vec(&json!({ "role": role, "path": path })).unwrap(),
        )
    }

    fn files(&self) -> Vec<PathBuf> {
        let mut files: Vec<_> = fs::read_dir(self.scratch.path())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        files.sort();
        files
    }
}

#[test]
fn detects_and_opens_real_owners_and_config_without_creating_state_or_leases() {
    let fixture = Fixture::new();
    let files = fixture.files();
    let contents: Vec<_> = files.iter().map(|file| fs::read(file).unwrap()).collect();
    let rel = Rel::open(&fixture.main).unwrap();
    let phy = Phylactery::open(&fixture.phy).unwrap();
    let project = Rel::open(&fixture.project).unwrap();
    let report = fixture.report(&fixture.request());
    assert_eq!(
        report,
        json!({
            "valid": true,
            "main_rel": {
                "accepted": true, "opened": true, "kind": "rel", "scope": "organization",
                "owner_id": rel.owner_id(), "error": null
            },
            "active_phy": {
                "accepted": true, "opened": true, "kind": "phy", "scope": null,
                "owner_id": phy.owner_id(), "error": null
            },
            "projects": {
                "demo": {
                    "accepted": true, "opened": true, "kind": "rel", "scope": "project",
                    "owner_id": project.owner_id(), "error": null
                }
            },
            "config": {"accepted": true, "opened": true, "error": null},
            "topology_error": null
        })
    );
    assert_eq!(fixture.files(), files);
    for (file, content) in files.iter().zip(contents) {
        assert_eq!(fs::read(file).unwrap(), content, "{file:?}");
    }
    assert!(!fixture.state.exists());
    let gateway = Gateway::new();
    assert_eq!(gateway.mount_rel(&rel, true).unwrap(), rel.owner_id());
    assert_eq!(
        gateway.mount_rel(&project, true).unwrap(),
        project.owner_id()
    );
    let busy = fixture.report(&fixture.request());
    assert_eq!(busy["valid"], false);
    assert_eq!(busy["main_rel"]["error"], "owner_writer_conflict");
    assert_eq!(busy["main_rel"]["opened"], false);
    drop(gateway);
    assert_eq!(fixture.report(&fixture.request())["valid"], true);
}

#[test]
fn identifies_wrong_kind_wrong_scope_missing_and_corrupt_files() {
    let fixture = Fixture::new();
    let corrupt = fixture.scratch.path().join("corrupt.owner");
    fs::write(&corrupt, b"corrupt owner").unwrap();
    let mut request = fixture.request();
    request["owners"]["main_rel"] = json!(fixture.phy);
    request["owners"]["active_phy"] = json!(fixture.main);
    request["owners"]["projects"] = json!({
        "wrong-scope": fixture.main,
        "missing": fixture.scratch.path().join("missing.owner"),
        "corrupt": corrupt
    });
    let report = fixture.report(&request);
    assert_eq!(report["valid"], false);
    assert_eq!(report["main_rel"]["error"], "wrong_owner_kind");
    assert_eq!(report["main_rel"]["kind"], "phy");
    assert_eq!(report["main_rel"]["opened"], true);
    assert_eq!(report["active_phy"]["error"], "wrong_owner_kind");
    assert_eq!(report["active_phy"]["kind"], "rel");
    assert_eq!(
        report["projects"]["wrong-scope"]["error"],
        "project_rel_scope"
    );
    assert_eq!(report["projects"]["missing"]["error"], "owner_unavailable");
    assert_eq!(report["projects"]["corrupt"]["accepted"], false);
    assert_eq!(report["projects"]["corrupt"]["opened"], false);
    assert_eq!(report["projects"]["corrupt"]["owner_id"], Value::Null);

    request["owners"]["main_rel"] = json!(fixture.project);
    assert_eq!(
        fixture.report(&request)["main_rel"]["error"],
        "main_rel_scope"
    );
}

#[test]
fn rejects_unopenable_config_and_keeps_config_optional() {
    let fixture = Fixture::new();
    let invalid = fixture.scratch.path().join("invalid.cfg");
    fs::write(&invalid, b"invalid configuration").unwrap();
    let mut request = fixture.request();
    request["config_path"] = json!(invalid);
    let report = fixture.report(&request);
    assert_eq!(report["valid"], false);
    assert_eq!(
        report["config"],
        json!({"accepted": false, "opened": false, "error": "invalid_processing_config"})
    );

    request["config_path"] = Value::Null;
    let report = fixture.report(&request);
    assert_eq!(report["valid"], true);
    assert_eq!(
        report["config"],
        json!({"accepted": true, "opened": false, "error": null})
    );
}

#[test]
fn rejects_duplicate_identity_and_mismatched_persisted_topology_without_writes() {
    let fixture = Fixture::new();
    let mut request = fixture.request();
    let alias = fixture.scratch.path().join("copy.owner");
    fs::copy(&fixture.project, &alias).unwrap();
    request["owners"]["projects"]["copy"] = json!(alias);
    let report = fixture.report(&request);
    assert_eq!(report["valid"], false);
    assert_eq!(report["topology_error"], "duplicate_owner");

    let mut request = fixture.request();
    let report = fixture.report(&request);
    fs::create_dir_all(&fixture.state).unwrap();
    let topology_path = fixture.state.join("topology-v1.json");
    let topology = serde_json::to_vec(&json!({
        "version": 1,
        "profile_id": "setup-profile",
        "principal_id": "setup-principal",
        "main_rel": report["main_rel"]["owner_id"],
        "active_phy": report["active_phy"]["owner_id"],
        "projects": {"demo": {
            "parent_id": report["main_rel"]["owner_id"],
            "rel_id": report["projects"]["demo"]["owner_id"],
        }}
    }))
    .unwrap();
    fs::write(&topology_path, &topology).unwrap();
    assert_eq!(fixture.report(&request)["valid"], true);

    let other_main = fixture.scratch.path().join("other.owner");
    Rel::create(&other_main, OwnerScope::Organization).unwrap();
    request["owners"]["main_rel"] = json!(other_main);
    let report = fixture.report(&request);
    assert_eq!(report["valid"], false);
    assert_eq!(report["topology_error"], "owner_topology_changed");
    assert_eq!(fs::read(&topology_path).unwrap(), topology);
    assert_eq!(fs::read_dir(&fixture.state).unwrap().count(), 1);
}

#[test]
fn creates_all_roles_and_reselects_them_through_setup_validation() {
    let fixture = Fixture::new();
    let mut request = fixture.request();
    let mut checks = Vec::new();
    for (role, file, kind, scope) in [
        ("main_rel", "new general.REL", "rel", json!("unspecified")),
        ("active_phy", "new identity.phy", "phy", Value::Null),
        ("project_rel", "new project.rel", "rel", json!("project")),
    ] {
        let path = fixture.scratch.path().join(file);
        let output = fixture.create(role, &path);
        assert!(output.status.success(), "{:?}", output.stderr);
        assert!(output.stderr.is_empty());
        let check: Value = serde_json::from_slice(&output.stdout).unwrap();
        let id = check["owner_id"].as_str().unwrap();
        assert_eq!(id.len(), 32);
        assert!(id.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_eq!(check["kind"], kind);
        assert_eq!(check["scope"], scope);
        assert_eq!(check["accepted"], true);
        assert_eq!(check["opened"], true);
        assert_eq!(check["error"], Value::Null);
        checks.push(check);
        if role == "project_rel" {
            request["owners"]["projects"]["demo"] = json!(path);
        } else {
            request["owners"][role] = json!(path);
        }
    }

    let report = fixture.report(&request);
    assert_eq!(report["valid"], true);
    assert_eq!(report["main_rel"], checks[0]);
    assert_eq!(report["active_phy"], checks[1]);
    assert_eq!(report["projects"]["demo"], checks[2]);
    assert!(fixture.files().iter().all(|path| path.is_file()));
    assert!(!fixture.state.exists());
}

fn assert_create_error(output: Output, code: &str) {
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert_eq!(
        String::from_utf8(output.stderr).unwrap().trim(),
        format!("reliquary-hermes-host: {code}")
    );
}

#[test]
fn create_never_overwrites_an_existing_or_concurrently_created_path() {
    let fixture = Fixture::new();
    let existing = fixture.scratch.path().join("existing.rel");
    fs::write(&existing, b"original contents").unwrap();
    assert_create_error(
        fixture.create("main_rel", &existing),
        "owner_already_exists",
    );
    assert_eq!(fs::read(existing).unwrap(), b"original contents");

    let path = fixture.scratch.path().join("racing.rel");
    let (first, second) = std::thread::scope(|scope| {
        let first = scope.spawn(|| fixture.create("main_rel", &path));
        let second = scope.spawn(|| fixture.create("project_rel", &path));
        (first.join().unwrap(), second.join().unwrap())
    });
    let (success, failure) = if first.status.success() {
        (first, second)
    } else {
        (second, first)
    };
    assert!(success.status.success(), "{:?}", success.stderr);
    assert_create_error(failure, "owner_already_exists");
    let check: Value = serde_json::from_slice(&success.stdout).unwrap();
    assert_eq!(
        check["owner_id"],
        json!(Rel::verify(&path).unwrap().owner_id)
    );
    assert!(fixture.files().iter().all(|path| path.is_file()));
    assert!(!fixture.state.exists());
}

#[test]
fn create_rejects_invalid_paths_and_unknown_request_fields() {
    let fixture = Fixture::new();
    let before = fixture.files();
    for path in [
        PathBuf::from("relative.rel"),
        fixture.scratch.path().join("wrong.phy"),
        fixture.scratch.path().join("missing").join("owner.rel"),
        fixture.scratch.path().join("..").join("escape.rel"),
    ] {
        assert_create_error(fixture.create("main_rel", &path), "invalid_owner_path");
    }
    #[cfg(windows)]
    for path in [
        PathBuf::from(r"\\server\share\owner.rel"),
        fixture.scratch.path().join("AUX.rel"),
        fixture.scratch.path().join("owner:alternate.rel"),
    ] {
        assert_create_error(fixture.create("main_rel", &path), "invalid_owner_path");
    }
    let request = json!({
        "role": "main_rel",
        "path": fixture.scratch.path().join("extra.rel"),
        "project_id": "untrusted"
    });
    assert_create_error(
        fixture.run_command("setup-create", &serde_json::to_vec(&request).unwrap()),
        "invalid_setup_request",
    );
    assert_eq!(fixture.files(), before);
}

#[test]
fn rejects_unknown_duplicate_and_oversize_input_with_fixed_diagnostics() {
    let fixture = Fixture::new();
    let mut request = fixture.request();
    request["credential"] = json!("private-input-marker");
    for raw in [
        serde_json::to_vec(&request).unwrap(),
        br#"{"owners":{},"owners":{}}"#.to_vec(),
        vec![b' '; 262_145],
    ] {
        let output = fixture.run(&raw);
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert_eq!(
            String::from_utf8(output.stderr).unwrap().trim(),
            "reliquary-hermes-host: invalid_setup_request"
        );
    }
}
