//! Exact private source-adapter wire, separate from model tool requests.
use crate::{
    service_http::{HttpError, INVALID, hex},
    service_protocol::{PROTOCOL_VERSION, decode, valid_id},
};
use reliquary_memory::{HermesCopiedAuthor, HermesCopiedMessage, HermesCopiedRole};
use serde::{Deserialize, Serialize};
use serde_json::{Value, value::RawValue};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

#[derive(Clone, Copy, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SourceAction {
    Snapshot,
    Invalidate,
    Terminal,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SourceRequest {
    protocol_version: u16,
    pub(crate) profile_id: String,
    pub(crate) principal_id: String,
    pub(crate) session_id: String,
    pub(crate) generation: u64,
    pub(crate) idempotency_key: String,
    pub(crate) operation: SourceAction,
    pub(crate) arguments: Value,
}

impl SourceRequest {
    pub(crate) fn parse(bytes: &[u8]) -> Result<Self, HttpError> {
        let value: Self = decode(bytes).map_err(|_| INVALID)?;
        if value.protocol_version != PROTOCOL_VERSION
            || value.generation > i64::MAX as u64
            || ![&value.profile_id, &value.principal_id, &value.session_id]
                .into_iter()
                .all(|id| valid_id(id))
            || !is_digest(&value.idempotency_key)
        {
            return Err(INVALID);
        }
        match value.operation {
            SourceAction::Snapshot => {
                serde_json::from_value::<SnapshotArguments>(value.arguments.clone())
                    .map_err(|_| INVALID)?;
            }
            SourceAction::Invalidate
                if value.arguments.as_object().is_some_and(|v| v.is_empty()) => {}
            SourceAction::Terminal => {
                let terminal: TerminalArguments =
                    serde_json::from_value(value.arguments.clone()).map_err(|_| INVALID)?;
                if !matches!(terminal.reason.as_str(), "archive" | "delete") {
                    return Err(INVALID);
                }
            }
            _ => return Err(INVALID),
        }
        Ok(value)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SnapshotArguments {
    snapshot_digest: String,
    source_json: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TerminalArguments {
    reason: String,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Evidence {
    pub(crate) uid: String,
    pub(crate) digest: [u8; 32],
}

pub(crate) struct Snapshot {
    pub(crate) digest: String,
    pub(crate) branch: Option<String>,
    pub(crate) revision: Option<String>,
    pub(crate) evidence: Vec<Evidence>,
    pub(crate) messages: Vec<HermesCopiedMessage>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CopiedView {
    profile_id: String,
    session_id: String,
    branch_id: Option<String>,
    source_revision: Option<String>,
    messages: Vec<Message>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Message {
    message_uid: String,
    role: Role,
    timestamp: Box<RawValue>,
    content: String,
    author: HermesCopiedAuthor,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Role {
    User,
    Assistant,
    System,
    Tool,
}

impl From<Role> for HermesCopiedRole {
    fn from(role: Role) -> Self {
        match role {
            Role::User => Self::User,
            Role::Assistant => Self::Assistant,
            Role::System => Self::System,
            Role::Tool => Self::Tool,
        }
    }
}

impl Snapshot {
    pub(crate) fn parse(request: &SourceRequest) -> Result<Self, HttpError> {
        let arguments: SnapshotArguments =
            serde_json::from_value(request.arguments.clone()).map_err(|_| INVALID)?;
        let digest = hex(&Sha256::digest(arguments.source_json.as_bytes()));
        if arguments.snapshot_digest != digest {
            return Err(INVALID);
        }
        // Check nested duplicate keys before taking exact timestamp lexemes.
        let _: Value = decode(arguments.source_json.as_bytes()).map_err(|_| INVALID)?;
        let view: CopiedView = serde_json::from_str(&arguments.source_json).map_err(|_| INVALID)?;
        if view.profile_id != request.profile_id
            || view.session_id != request.session_id
            || !(1..=128).contains(&view.messages.len())
            || view
                .branch_id
                .iter()
                .chain(&view.source_revision)
                .any(|id| !valid_id(id))
        {
            return Err(INVALID);
        }
        let mut evidence = Vec::with_capacity(view.messages.len());
        let mut messages = Vec::with_capacity(view.messages.len());
        let mut seen = BTreeSet::new();
        for row in view.messages {
            if !valid_id(&row.message_uid)
                || !seen.insert(row.message_uid.clone())
                || row.content.len() > 32_768
                || row.author.id.as_ref().is_some_and(|id| !valid_id(id))
            {
                return Err(INVALID);
            }
            let timestamp_ns = epoch_ns(row.timestamp.get()).ok_or(INVALID)?;
            let exact = serde_json::to_vec(&(&row.role, &row.timestamp, &row.content, &row.author))
                .map_err(|_| INVALID)?;
            evidence.push(Evidence {
                uid: row.message_uid.clone(),
                digest: Sha256::digest(exact).into(),
            });
            messages.push(HermesCopiedMessage {
                message_uid: row.message_uid,
                role: row.role.into(),
                timestamp_ns,
                content: row.content,
                author: Some(row.author),
            });
        }
        Ok(Self {
            digest,
            branch: view.branch_id,
            revision: view.source_revision,
            evidence,
            messages,
        })
    }
}

fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

// Preserve the source decimal through the native nanosecond boundary. A
// subnanosecond remainder rounds once, and the wire digest retains the lexeme.
fn epoch_ns(raw: &str) -> Option<i64> {
    let (mantissa, exponent) = match raw.split_once(['e', 'E']) {
        Some((mantissa, exponent)) => (mantissa, exponent.parse::<i32>().ok()?),
        None => (raw, 0),
    };
    let (integer, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let digits = format!("{integer}{fraction}");
    if integer.is_empty() || !digits.bytes().all(|digit| digit.is_ascii_digit()) {
        return None;
    }
    let count = i32::try_from(integer.len())
        .ok()?
        .checked_add(exponent)?
        .checked_add(9)?;
    if count < 0 {
        return Some(0);
    }
    let count = usize::try_from(count).ok()?;
    let mut value = 0i64;
    for digit in digits.bytes().take(count) {
        value = value
            .checked_mul(10)?
            .checked_add(i64::from(digit - b'0'))?;
    }
    if count > digits.len() && value != 0 {
        value = value.checked_mul(10i64.checked_pow(u32::try_from(count - digits.len()).ok()?)?)?;
    }
    value.checked_add(i64::from(
        digits
            .as_bytes()
            .get(count)
            .is_some_and(|digit| *digit >= b'5'),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn original_decimal_does_not_round_through_binary_epoch_seconds() {
        assert_eq!(
            epoch_ns("1700000000.0000001"),
            Some(1_700_000_000_000_000_100)
        );
        assert_eq!(epoch_ns("1e-6"), Some(1000));
        assert_eq!(epoch_ns("0.0000000005"), Some(1));
        assert_eq!(epoch_ns("9223372036.854775808"), None);
        assert_eq!(epoch_ns("\"5\""), None);
    }
}
