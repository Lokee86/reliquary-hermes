//! Strict wire decoding for the HP03 lifecycle and frozen provider envelope.
use serde::{
    Deserialize, Deserializer, Serialize,
    de::{self, DeserializeOwned, MapAccess, SeqAccess, Visitor},
};
use serde_json::{Map, Value, json};
use std::{collections::BTreeSet, fmt};

pub(crate) const PROTOCOL_VERSION: u16 = 1;
pub(crate) const HERMES_REVISION: &str = "2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuntimeAttachRequest {
    pub(crate) integration_kind: String,
    pub(crate) runtime_id: String,
    pub(crate) principal_id: String,
    #[serde(default)]
    pub(crate) session_id: Option<String>,
}

impl RuntimeAttachRequest {
    pub(crate) fn valid(&self) -> bool {
        [&self.integration_kind, &self.runtime_id, &self.principal_id]
            .into_iter()
            .all(|value| valid_id(value))
            && self.session_id.as_ref().is_none_or(|value| valid_id(value))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuntimeLeaseRequest {
    pub(crate) lease_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuntimeDetachRequest {
    pub(crate) lease_id: String,
    pub(crate) clean: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuntimeScopeRequest {
    pub(crate) lease_id: String,
    pub(crate) session_id: String,
}

#[derive(Debug)]
pub(crate) struct InvalidWire;

pub(crate) fn decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, InvalidWire> {
    let value: UniqueValue = serde_json::from_slice(bytes).map_err(|_| InvalidWire)?;
    serde_json::from_value(value.0).map_err(|_| InvalidWire)
}

/// Unlike Value's decoder, reject duplicate keys at every level.
struct UniqueValue(Value);

impl<'de> Deserialize<'de> for UniqueValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct UniqueVisitor;

        impl<'de> Visitor<'de> for UniqueVisitor {
            type Value = UniqueValue;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a JSON value with unique object keys")
            }

            fn visit_bool<E: de::Error>(self, value: bool) -> Result<Self::Value, E> {
                Ok(UniqueValue(value.into()))
            }

            fn visit_i64<E: de::Error>(self, value: i64) -> Result<Self::Value, E> {
                Ok(UniqueValue(value.into()))
            }

            fn visit_u64<E: de::Error>(self, value: u64) -> Result<Self::Value, E> {
                Ok(UniqueValue(value.into()))
            }

            fn visit_f64<E: de::Error>(self, value: f64) -> Result<Self::Value, E> {
                serde_json::Number::from_f64(value)
                    .map(|number| UniqueValue(Value::Number(number)))
                    .ok_or_else(|| E::custom("nonfinite number"))
            }

            fn visit_str<E: de::Error>(self, value: &str) -> Result<Self::Value, E> {
                Ok(UniqueValue(value.into()))
            }

            fn visit_string<E: de::Error>(self, value: String) -> Result<Self::Value, E> {
                Ok(UniqueValue(value.into()))
            }

            fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
                Ok(UniqueValue(Value::Null))
            }

            fn visit_seq<A: SeqAccess<'de>>(self, mut input: A) -> Result<Self::Value, A::Error> {
                let mut values = Vec::new();
                while let Some(UniqueValue(value)) = input.next_element()? {
                    values.push(value);
                }
                Ok(UniqueValue(Value::Array(values)))
            }

            fn visit_map<A: MapAccess<'de>>(self, mut input: A) -> Result<Self::Value, A::Error> {
                let mut fields = Map::new();
                while let Some((key, UniqueValue(value))) = input.next_entry::<String, _>()? {
                    if fields.insert(key, value).is_some() {
                        return Err(de::Error::custom("duplicate field"));
                    }
                }
                Ok(UniqueValue(Value::Object(fields)))
            }
        }

        deserializer.deserialize_any(UniqueVisitor)
    }
}

pub(crate) fn valid_id(value: &str) -> bool {
    value.len() <= 128
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.:-".contains(&byte))
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Discovery {
    pub(crate) endpoint: String,
    pub(crate) instance_id: String,
    pub(crate) profile_id: String,
    pub(crate) protocol_version: u16,
    pub(crate) hermes_revision: String,
    pub(crate) lease_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AttachRequest {
    pub(crate) discovery: Discovery,
    pub(crate) principal_id: String,
    pub(crate) session_id: String,
}

impl AttachRequest {
    pub(crate) fn valid(&self) -> bool {
        valid_id(&self.principal_id) && valid_id(&self.session_id)
    }
}

#[derive(Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Operation {
    SnapshotSubmit,
    MemoryQuery,
    RefineQuery,
    TraverseGraph,
    OwnerStatus,
    InspectMemory,
    EditMemory,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProviderRequest {
    pub(crate) protocol_version: u16,
    pub(crate) request_id: String,
    pub(crate) operation: Operation,
    pub(crate) profile_id: String,
    pub(crate) principal_id: String,
    pub(crate) session_id: String,
    pub(crate) turn_id: String,
    expected_revision: Value,
    idempotency_key: Value,
    pub(crate) arguments: Value,
}

impl ProviderRequest {
    pub(crate) fn retrieval_scope(&self) -> (&str, &str, &str, &str) {
        (
            &self.profile_id,
            &self.principal_id,
            &self.session_id,
            &self.turn_id,
        )
    }

    pub(crate) fn retrieval_request_id(&self) -> &str {
        &self.request_id
    }

    pub(crate) fn valid(&self) -> bool {
        let valid_id_fields = [
            &self.request_id,
            &self.profile_id,
            &self.principal_id,
            &self.session_id,
            &self.turn_id,
        ]
        .into_iter()
        .all(|value| valid_id(value));
        if self.protocol_version != PROTOCOL_VERSION || !valid_id_fields {
            return false;
        }
        let mutates = matches!(
            self.operation,
            Operation::SnapshotSubmit | Operation::EditMemory
        );
        let mutation_fields = [&self.expected_revision, &self.idempotency_key];
        if !mutation_fields.into_iter().all(|value| {
            if mutates {
                is_id(value)
            } else {
                value.is_null()
            }
        }) {
            return false;
        }
        self.valid_arguments()
    }

    fn valid_arguments(&self) -> bool {
        let value = &self.arguments;
        let has = |keys| exact_fields(value, keys);
        let query = || is_text(&value["query"], 4096, false) && bounded(&value["limit"], 1, 50);
        match self.operation {
            Operation::OwnerStatus => has(&[][..]),
            Operation::MemoryQuery => has(&["query", "limit"]) && query(),
            Operation::RefineQuery => {
                has(&["query", "limit", "search_id", "selected_ids"])
                    && query()
                    && is_id(&value["search_id"])
                    && id_list(&value["selected_ids"], 0)
            }
            Operation::TraverseGraph => {
                has(&["seed_ids", "depth", "limit", "cut"])
                    && id_list(&value["seed_ids"], 1)
                    && bounded(&value["depth"], 1, 3)
                    && bounded(&value["limit"], 1, 50)
                    && is_id(&value["cut"])
            }
            Operation::InspectMemory => {
                has(&["memory_id", "cut"]) && is_id(&value["memory_id"]) && is_id(&value["cut"])
            }
            Operation::EditMemory => {
                has(&["memory_id", "action", "content", "origin"])
                    && is_id(&value["memory_id"])
                    && value["origin"] == "authenticated_user"
                    && match value["action"].as_str() {
                        Some("replace") => is_text(&value["content"], 32768, false),
                        Some("delete") => value["content"] == "",
                        _ => false,
                    }
            }
            Operation::SnapshotSubmit => {
                validate_snapshot_shape(value, &self.profile_id, &self.session_id)
            }
        }
    }

    pub(crate) fn response(&self, status: &str, result: Value) -> Value {
        json!({
            "protocol_version": PROTOCOL_VERSION,
            "request_id": self.request_id,
            "operation": self.operation,
            "status": status,
            "revision": null,
            "cut": null,
            "result": result,
        })
    }

    pub(crate) fn error(&self, status: &str, code: &str, retryable: bool) -> Value {
        self.response(status, json!({"code": code, "retryable": retryable}))
    }
}

fn exact_fields(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|fields| {
        fields.len() == keys.len() && keys.iter().all(|k| fields.contains_key(*k))
    })
}

fn is_id(value: &Value) -> bool {
    value.as_str().is_some_and(valid_id)
}

fn bounded(value: &Value, min: u64, max: u64) -> bool {
    value
        .as_u64()
        .is_some_and(|integer| (min..=max).contains(&integer))
}

fn is_text(value: &Value, max: usize, allow_blank: bool) -> bool {
    value
        .as_str()
        .is_some_and(|text| text.len() <= max && (allow_blank || !text.trim().is_empty()))
}

fn id_list(value: &Value, min: usize) -> bool {
    let Some(values) = value.as_array() else {
        return false;
    };
    let mut seen = BTreeSet::new();
    (min..=50).contains(&values.len())
        && values.iter().all(|value| {
            value
                .as_str()
                .is_some_and(|id| valid_id(id) && seen.insert(id))
        })
}

fn validate_snapshot_shape(value: &Value, profile: &str, session: &str) -> bool {
    // HP03 can reject malformed copied snapshots, but there is no trusted
    // source registration, digest verification or import in this ticket.
    if !exact_fields(
        value,
        &[
            "authority",
            "profile_id",
            "session_id",
            "branch_id",
            "source_revision",
            "snapshot_digest",
            "availability",
            "messages",
        ],
    ) || value["authority"] != "hermes_source_copied_snapshot"
        || value["profile_id"] != profile
        || value["session_id"] != session
        || [&value["branch_id"], &value["source_revision"]]
            .into_iter()
            .any(|field| !field.is_null() && !is_id(field))
        || !value["snapshot_digest"].as_str().is_some_and(|digest| {
            digest.len() == 64
                && digest
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
    {
        return false;
    }
    let Some(messages) = value["messages"].as_array() else {
        return false;
    };
    if messages.len() > 128
        || match value["availability"].as_str() {
            Some("current") => false,
            Some("unavailable" | "stale" | "deleted") => !messages.is_empty(),
            _ => true,
        }
    {
        return false;
    }
    let mut seen = BTreeSet::new();
    messages.iter().all(|message| {
        exact_fields(
            message,
            &["message_uid", "role", "timestamp", "content", "author"],
        ) && message["message_uid"]
            .as_str()
            .is_some_and(|id| valid_id(id) && seen.insert(id))
            && matches!(
                message["role"].as_str(),
                Some("user" | "assistant" | "system" | "tool")
            )
            && message["timestamp"]
                .as_f64()
                .is_some_and(|timestamp| timestamp >= 0.0)
            && is_text(&message["content"], 32768, true)
            && exact_fields(&message["author"], &["id", "is_bot"])
            && (message["author"]["id"].is_null() || is_id(&message["author"]["id"]))
            && (message["author"]["is_bot"].is_null() || message["author"]["is_bot"].is_boolean())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strict_decoder_rejects_nested_duplicate_keys_and_invalid_numbers() {
        assert!(decode::<Value>(br#"{"outer":{"same":1,"same":2}}"#).is_err());
        assert!(decode::<Value>(br#"{"number":1e999}"#).is_err());
        assert!(decode::<Value>(br#"{"outer":[{"x":1},{"x":2}]}"#).is_ok());
    }

    #[test]
    fn owner_status_has_no_caller_owner_or_mutation_authority() {
        let mut request = json!({
            "protocol_version": 1,
            "request_id": "query",
            "operation": "owner_status",
            "profile_id": "profile",
            "principal_id": "principal",
            "session_id": "session",
            "turn_id": "turn",
            "expected_revision": null,
            "idempotency_key": null,
            "arguments": {},
        });
        let parse = |value: &Value| decode::<ProviderRequest>(&serde_json::to_vec(value).unwrap());
        assert!(parse(&request).unwrap().valid());
        request["arguments"] = json!({"owner_id":"foreign"});
        assert!(!parse(&request).unwrap().valid());
        request["arguments"] = json!({});
        request.as_object_mut().unwrap().remove("expected_revision");
        assert!(parse(&request).is_err());
    }
}
