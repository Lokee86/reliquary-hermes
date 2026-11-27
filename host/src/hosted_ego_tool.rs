//! Bounded local tokenizer continuations over Hermes' structured model facade.

use reliquary_memory::{GeneralEndpointError, GeneralTool};
use serde_json::{Value, json};

pub(super) fn run_job(
    instructions: &str,
    input: &str,
    schema: &Value,
    tool: GeneralTool<'_>,
    count: &mut dyn FnMut(Value) -> Result<Value, GeneralEndpointError>,
    mut complete: impl FnMut(&str, &str, &Value) -> Result<Value, GeneralEndpointError>,
) -> Result<Value, GeneralEndpointError> {
    let source: Value = serde_json::from_str(input)
        .map_err(|_| GeneralEndpointError::InvalidConfiguration("invalid Ego tool job input"))?;
    let instructions = format!(
        "{instructions}\nUse the response action `tokenize` to call the supplied local tokenizer. Put the exact input in arguments and set candidate to null. Read the returned tokenizer_results. Use action `finish` with a terminal candidate and null arguments. Respond with finish when remaining is zero."
    );
    let envelope = json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["action", "arguments", "candidate"],
        "properties": {
            "action": {"type": "string", "enum": ["tokenize", "finish"]},
            "arguments": {"anyOf": [tool.schema, {"type": "null"}]},
            "candidate": {"anyOf": [schema, {"type": "null"}]},
        }
    });
    let envelope_bytes = envelope.to_string().len();
    let mut results = Vec::new();
    for used in 0..=tool.max_results {
        let request = json!({
            "input": source,
            "tool": tool.name,
            "remaining": tool.max_results - used,
            "tokenizer_results": results,
        })
        .to_string();
        if instructions.len() + request.len() + envelope_bytes > tool.max_input_bytes {
            return Err(GeneralEndpointError::InvalidResponse(
                "Ego tool continuation exceeds route budget",
            ));
        }
        let response = complete(&instructions, &request, &envelope)?;
        match response["action"].as_str() {
            Some("finish")
                if response.get("arguments").is_some_and(Value::is_null)
                    && response["candidate"].is_object() =>
            {
                return Ok(response["candidate"].clone());
            }
            Some("tokenize")
                if used < tool.max_results
                    && response.get("candidate").is_some_and(Value::is_null)
                    && response["arguments"].is_object() =>
            {
                let arguments = response["arguments"].clone();
                let result = count(arguments.clone())?;
                results.push(json!({"arguments": arguments, "result": result}));
            }
            _ => {
                return Err(GeneralEndpointError::InvalidResponse(
                    "invalid Ego tokenizer continuation",
                ));
            }
        }
    }
    Err(GeneralEndpointError::InvalidResponse(
        "Ego tokenizer job exhausted",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shares_count_results_and_bounds_requests_in_one_job() {
        let mut seen = Vec::new();
        let terminal = run_job(
            "Compress",
            "{}",
            &json!({"type":"object"}),
            GeneralTool {
                name: "count",
                schema: &json!({"type":"object"}),
                max_results: 4,
                max_input_bytes: 4096,
            },
            &mut |arguments| Ok(json!({"count":arguments["text"].as_str().unwrap().len()})),
            |_, input, _| {
                let packet: Value = serde_json::from_str(input).unwrap();
                let remaining = packet["remaining"].as_u64().unwrap();
                seen.push(remaining);
                if remaining == 3 {
                    assert_eq!(packet["tokenizer_results"][0]["result"]["count"], 3);
                    Ok(json!({"action":"finish","arguments":null,"candidate":{"text":"abc"}}))
                } else {
                    Ok(json!({"action":"tokenize","arguments":{"text":"abc"},"candidate":null}))
                }
            },
        )
        .unwrap();
        assert_eq!(seen, [4, 3]);
        assert_eq!(terminal["text"], "abc");

        let mut counts = 0;
        let refused = run_job(
            "Compress",
            "{}",
            &json!({"type":"object"}),
            GeneralTool {
                name: "count",
                schema: &json!({"type":"object"}),
                max_results: 4,
                max_input_bytes: 4096,
            },
            &mut |_| {
                counts += 1;
                Ok(json!({"count":1}))
            },
            |_, _, _| Ok(json!({"action":"tokenize","arguments":{"text":"a"},"candidate":null})),
        );
        assert!(refused.is_err());
        assert_eq!(counts, 4);
    }
}
