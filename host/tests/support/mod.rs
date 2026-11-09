use reliquary_memory::{
    ConfiguredRuntime, CredentialId, DecisionModelEndpoint, EmbeddingModelEndpoint,
    EmbeddingNormalization, Gateway, GeneralModelEndpoint, GeneralRoute, HostAdmissionAdapter,
    HostAdmissionControl, HostCredentialBinding, Instance, ModelProvider, ModelRoute, ModelSlot,
    NativeImportFormat, NativeImportPlan, OwnerGrant, OwnerId, OwnerScope, Phylactery,
    ProcessOptions, ProcessingState, Rel, ReliquaryConfig, SecretString, TrustedHostAdmission,
};
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

pub const PROJECT: &str = "Lantern release uses the amber checklist.";
const PRIVATE: &str = "My preferred meeting window is afternoons.";
pub const DECOY: &str = "Lantern color is unrelated to the release checklist.";
pub const TOKEN: &str = "hp02-test-operator-admission-credential";
pub const OTHER_TOKEN: &str = "hp02-test-other-operator-admission-credential";

pub struct Fixture {
    pub rel_path: PathBuf,
    pub runtime: ConfiguredRuntime,
    pub processing_runtime: ConfiguredRuntime,
    _endpoint: Endpoint,
    directory: tempfile::TempDir,
}

pub struct Mounted {
    pub owner: OwnerId,
    pub admission: HostAdmissionAdapter,
    pub control: HostAdmissionControl,
    pub instance: Instance,
    pub phy_owner: OwnerId,
}

impl Fixture {
    pub fn new() -> Self {
        Self::with_private_fixture(true)
    }

    pub fn with_private_fixture(include_private: bool) -> Self {
        let scratch = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/hp02-fixtures");
        fs::create_dir_all(&scratch).unwrap();
        let directory = tempfile::Builder::new()
            .prefix("selected-return-")
            .tempdir_in(scratch)
            .unwrap();
        let endpoint = Endpoint::new(include_private);
        let (runtime, processing_runtime) = runtimes(directory.path(), endpoint.address);
        let rel_path = directory.path().join("project.rel");
        Rel::create(&rel_path, OwnerScope::Project).unwrap();
        Self {
            rel_path,
            runtime,
            processing_runtime,
            _endpoint: endpoint,
            directory,
        }
    }

    pub fn mount(&self) -> Mounted {
        let gateway = Gateway::new();
        let owner = gateway
            .mount_rel(&Rel::open(&self.rel_path).unwrap(), true)
            .unwrap();
        let phy_path = self.directory.path().join("private.phy");
        let phy = if phy_path.exists() {
            Phylactery::open(&phy_path).unwrap()
        } else {
            Phylactery::create(&phy_path).unwrap()
        };
        let phy_owner = gateway.mount_phylactery(&phy, true).unwrap();
        let (admission, control) = TrustedHostAdmission::new([
            HostCredentialBinding::new(
                "operator",
                TOKEN,
                [
                    OwnerGrant::ManageRel(owner),
                    OwnerGrant::OperateRel(owner),
                    OwnerGrant::OperatePhylactery(phy_owner),
                ],
            ),
            HostCredentialBinding::new("other", OTHER_TOKEN, [OwnerGrant::OperateRel(owner)]),
        ])
        .install(&gateway)
        .unwrap();
        let instance = admission.authenticate(TOKEN).unwrap();
        Mounted {
            owner,
            admission,
            control,
            instance,
            phy_owner,
        }
    }

    pub fn seed(&self, mounted: &Mounted) {
        let input = self.directory.path().join("conversations.json");
        fs::write(
            &input,
            json!([{
                "id":"chat","current_node":"accepted","mapping":{
                    "accepted":{"id":"accepted","parent":null,"children":[],"message":{
                        "id":"accepted","author":{"role":"user"},"create_time":1000,
                        "content":{"content_type":"text","parts":[format!("{PROJECT} {PRIVATE}")]}
                    }}
                }
            }])
            .to_string(),
        )
        .unwrap();
        let plan = NativeImportPlan::from_path(&input, NativeImportFormat::ChatGpt, None).unwrap();
        let stage = mounted
            .instance
            .stage_native_import(mounted.owner, plan)
            .unwrap();
        let report = mounted
            .instance
            .process_and_drain(
                mounted.owner,
                &self.processing_runtime,
                ProcessOptions {
                    import_id: Some(stage.import_id),
                    destination: Some(mounted.phy_owner),
                    max_episodes: 1,
                },
            )
            .unwrap();
        assert_eq!(report.state, ProcessingState::Ready, "{report:?}");
        assert_eq!(report.insomnia.rel_memories, 1);
        mounted
            .instance
            .workspace_management(mounted.owner)
            .unwrap()
            .create_memory(
                "Lantern decoy".into(),
                DECOY.into(),
                "fact".into(),
                "note".into(),
                1,
            )
            .unwrap();
    }

    pub fn rel_len(&self) -> u64 {
        fs::metadata(&self.rel_path).unwrap().len()
    }
}

fn runtimes(directory: &Path, address: SocketAddr) -> (ConfiguredRuntime, ConfiguredRuntime) {
    let url = format!("http://{address}");
    let path = directory.join("runtime.cfg");
    let mut config = ReliquaryConfig::new(&path);
    // Fixtures supply all model routes explicitly, even when Root installs development defaults.
    for slot in ModelSlot::ALL {
        config.clear_model(slot);
    }
    let credential_id = CredentialId::new("HP02_KEY").unwrap();
    config.add_api_key(
        credential_id.clone(),
        SecretString::new("synthetic-hp02-test-key").unwrap(),
    );
    for slot in [ModelSlot::General, ModelSlot::EntityResolution] {
        config
            .set_model(
                slot,
                &ModelRoute::General(GeneralRoute {
                    endpoint: GeneralModelEndpoint {
                        provider: ModelProvider::OpenAiReady,
                        model: "fixture".into(),
                        url: url.clone(),
                        credential_id: credential_id.clone(),
                    },
                    reasoning_effort: None,
                }),
            )
            .unwrap();
    }
    config
        .set_model(
            ModelSlot::Embedding,
            &ModelRoute::Embedding(EmbeddingModelEndpoint {
                provider: ModelProvider::OpenAiReady,
                model: "embedding-fixture".into(),
                url: url.clone(),
                credential_id: credential_id.clone(),
                dimensions: 2,
                normalization: EmbeddingNormalization::L2,
            }),
        )
        .unwrap();
    config
        .set_model(
            ModelSlot::MemoryRetrievalDecision,
            &ModelRoute::Decision(DecisionModelEndpoint {
                model: "retrieval-fixture".into(),
                url,
                credential_id,
            }),
        )
        .unwrap();
    let processing = config.configured_runtime().unwrap();
    config.clear_model(ModelSlot::Embedding);
    (config.configured_runtime().unwrap(), processing)
}

struct Endpoint {
    address: SocketAddr,
    stopping: Arc<AtomicBool>,
    server: Option<thread::JoinHandle<()>>,
}

impl Endpoint {
    fn new(include_private: bool) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let stopping = Arc::new(AtomicBool::new(false));
        let stop = stopping.clone();
        let server = thread::spawn(move || {
            for connection in listener.incoming() {
                let mut stream = connection.unwrap();
                if stop.load(Ordering::Acquire) {
                    break;
                }
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let body = reply(&read_request(&stream), include_private).to_string();
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                )
                .unwrap();
            }
        });
        Self {
            address,
            stopping,
            server: Some(server),
        }
    }
}

impl Drop for Endpoint {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Release);
        let _ = TcpStream::connect(self.address);
        let result = self.server.take().unwrap().join();
        if !thread::panicking() {
            result.unwrap();
        }
    }
}

fn read_request(stream: &TcpStream) -> Value {
    let mut reader = BufReader::new(stream);
    let mut length = None;
    loop {
        let mut line = String::new();
        assert_ne!(reader.read_line(&mut line).unwrap(), 0);
        if line == "\r\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                length = Some(value.trim().parse::<usize>().unwrap());
            }
        }
    }
    let length = length.unwrap();
    assert!(length < 1_000_000);
    let mut body = vec![0; length];
    reader.read_exact(&mut body).unwrap();
    serde_json::from_slice(&body).unwrap()
}

fn reply(request: &Value, include_private: bool) -> Value {
    if let Some(inputs) = request["input"].as_array() {
        let data = inputs
            .iter()
            .enumerate()
            .map(|(index, _)| json!({"index":index,"embedding":[1.0,0.0]}))
            .collect::<Vec<_>>();
        return json!({"data":data});
    }
    if request["model"] == "retrieval-fixture" {
        let state = &request["state"];
        assert_eq!(state["operation"], "memory_query");
        let candidates = state["candidates"].as_array().unwrap();
        let accepted_title = match state["query"].as_str().unwrap() {
            "lantern" => {
                assert_eq!(candidates.len(), 2);
                assert!(
                    candidates
                        .iter()
                        .any(|candidate| candidate["content"] == DECOY)
                );
                "Amber checklist"
            }
            "decoy" => "Lantern decoy",
            "overflow" => {
                assert_eq!(candidates.len(), 1);
                "Overflow note"
            }
            query => panic!("unexpected retrieval query {query}"),
        };
        let selected = candidates
            .iter()
            .find(|candidate| candidate["title"] == accepted_title)
            .unwrap();
        return json!({"version":1,"approved":[selected["memory"]]});
    }
    // Reuse the product's external-consumer import fixture shape to produce an
    // enrolled REL Memory and a separate PHY Memory without any lower-store API.
    let clause = |category, kind, text| {
        json!({
            "disposition":"retain","authority_kind":"direct","category":category,"type":kind,
            "lifecycle":"current","proposition":text,"authority_source_node_id":"",
            "grounding_source_node_id":"","reason":"direct source statement"
        })
    };
    let candidate = |category, kind, ownership, title, text| {
        json!({
            "authority_kind":"direct","category":category,"memory_type":kind,"temporal_status":"current",
            "ownership":ownership,"title":title,"content":text,"source_node_id":"accepted",
            "source_quote":text,"authority_source":null,"grounding_source":null,"routing_mentions":[]
        })
    };
    let output = match request["response_format"]["json_schema"]["name"]
        .as_str()
        .unwrap()
    {
        "insomnia_authority_disposition_ledger" => {
            let mut clauses = vec![clause("fact", "project", PROJECT)];
            if include_private {
                clauses.push(clause("preference", "communication", PRIVATE));
            }
            json!({"turns":{"accepted":clauses},"evidence_requests":[]})
        }
        "insomnia_memory_ownership" => {
            let mut ownership = json!({"g000":"project"});
            if include_private {
                ownership["g001"] = json!("user");
            }
            json!({"ownership":ownership})
        }
        "insomnia_memory_wording" => {
            let mut candidates = vec![candidate(
                "fact",
                "project",
                "project",
                "Amber checklist",
                PROJECT,
            )];
            if include_private {
                candidates.push(candidate(
                    "preference",
                    "communication",
                    "user",
                    "Meeting window",
                    PRIVATE,
                ));
            }
            json!({"candidates":candidates})
        }
        schema => panic!("unexpected provider schema {schema}"),
    };
    json!({"choices":[{"message":{"content":output.to_string()}}]})
}
