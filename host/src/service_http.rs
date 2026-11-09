//! Bounded HTTP/1.1 and per-instance message authentication for loopback clients.
use ring::hmac;
use serde_json::{Value, json};
use std::{
    io::{self, Read, Write},
    net::TcpStream,
    time::{Duration, Instant},
};

pub(crate) const MAX_WIRE_BYTES: usize = 256 * 1024;
const MAX_HEADER_BYTES: usize = 8 * 1024;
const READ_DEADLINE: Duration = Duration::from_secs(4);
const WRITE_TIMEOUT: Duration = Duration::from_secs(1);

pub(crate) const ATTACH: &str = "/v1/attach";
pub(crate) const REQUEST: &str = "/v1/request";
pub(crate) const RETRIEVAL_PREPARE: &str = "/v1/retrieval/prepare";
pub(crate) const SOURCE: &str = "/v1/source";
pub(crate) const DASHBOARD_READ: &str = "/v1/dashboard/read";
pub(crate) const DASHBOARD_TOPOLOGY: &str = "/v1/dashboard/topology";
pub(crate) const RUNTIME_ATTACH: &str = "/v1/runtime/attach";
pub(crate) const RUNTIME_HEARTBEAT: &str = "/v1/runtime/heartbeat";
pub(crate) const RUNTIME_DETACH: &str = "/v1/runtime/detach";
pub(crate) const RUNTIME_SCOPE: &str = "/v1/runtime/scope";

pub(crate) struct TransportKey(hmac::Key);

impl TransportKey {
    pub(crate) fn derive(token: &str, instance: &str, lease: &str) -> Self {
        let master = hmac::Key::new(hmac::HMAC_SHA256, token.as_bytes());
        let key = mac(
            &master,
            &[
                b"reliquary-hermes-transport-v1\0",
                instance.as_bytes(),
                b"\0",
                lease.as_bytes(),
            ],
        );
        Self(hmac::Key::new(hmac::HMAC_SHA256, key.as_ref()))
    }

    fn verify_request(&self, path: &str, nonce: &[u8; 32], body: &[u8], tag: &[u8; 32]) -> bool {
        let mut message = Vec::with_capacity(10 + path.len() + nonce.len() + body.len());
        for part in [
            b"request\0".as_slice(),
            path.as_bytes(),
            b"\0",
            nonce,
            b"\0",
            body,
        ] {
            message.extend_from_slice(part);
        }
        hmac::verify(&self.0, &message, tag).is_ok()
    }

    fn response_proof(&self, nonce: &[u8; 32], status: u16, body: &[u8]) -> String {
        let status = status.to_string();
        let tag = mac(
            &self.0,
            &[b"response\0", nonce, b"\0", status.as_bytes(), b"\0", body],
        );
        hex(tag.as_ref())
    }
}

fn mac(key: &hmac::Key, parts: &[&[u8]]) -> hmac::Tag {
    let mut context = hmac::Context::with_key(key);
    for part in parts {
        context.update(part);
    }
    context.sign()
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        result.push(char::from(ALPHABET[usize::from(byte >> 4)]));
        result.push(char::from(ALPHABET[usize::from(byte & 0x0f)]));
    }
    result
}

fn nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
    }
}

fn decode_tag(tag: &[u8]) -> Option<[u8; 32]> {
    let tag: &[u8; 64] = tag.try_into().ok()?;
    let mut bytes = [0; 32];
    for (byte, digits) in bytes.iter_mut().zip(tag.chunks_exact(2)) {
        *byte = (nibble(digits[0])? << 4) | nibble(digits[1])?;
    }
    Some(bytes)
}

pub(crate) struct HttpRequest {
    pub(crate) path: &'static str,
    pub(crate) nonce: [u8; 32],
    pub(crate) body: Vec<u8>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct HttpError {
    status: u16,
    code: &'static str,
    retryable: bool,
}

impl HttpError {
    pub(crate) const fn new(status: u16, code: &'static str, retryable: bool) -> Self {
        Self {
            status,
            code,
            retryable,
        }
    }

    pub(crate) const fn status_code(self) -> u16 {
        self.status
    }
    pub(crate) const fn code(self) -> &'static str {
        self.code
    }
    pub(crate) const fn retryable(self) -> bool {
        self.retryable
    }

    pub(crate) fn into_response(self) -> HttpResponse {
        HttpResponse {
            status: self.status,
            body: json!({"code": self.code, "retryable": self.retryable}),
        }
    }
}

pub(crate) const INVALID: HttpError = HttpError::new(400, "invalid_request", false);
pub(crate) const FORBIDDEN: HttpError = HttpError::new(403, "denied", false);
pub(crate) const UNAVAILABLE: HttpError = HttpError::new(503, "unavailable", true);
const UNAUTHENTICATED: HttpError = HttpError::new(401, "denied", false);
const TIMEOUT: HttpError = HttpError::new(408, "request_timeout", true);
const TOO_LARGE: HttpError = HttpError::new(413, "wire_limit", false);

pub(crate) struct HttpResponse {
    pub(crate) status: u16,
    pub(crate) body: Value,
}

impl HttpResponse {
    pub(crate) fn ok(body: Value) -> Self {
        Self { status: 200, body }
    }
}

fn read(stream: &mut TcpStream, buffer: &mut [u8], deadline: Instant) -> Result<usize, HttpError> {
    let timeout = deadline
        .checked_duration_since(Instant::now())
        .ok_or(TIMEOUT)?;
    if timeout.is_zero() {
        return Err(TIMEOUT);
    }
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|_| INVALID)?;
    stream.read(buffer).map_err(|error| match error.kind() {
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut => TIMEOUT,
        _ => INVALID,
    })
}

fn header<'a>(headers: &[httparse::Header<'a>], name: &str) -> Result<Option<&'a [u8]>, HttpError> {
    let mut matches = headers
        .iter()
        .filter(|header| header.name.eq_ignore_ascii_case(name));
    let value = matches.next().map(|header| header.value);
    if matches.next().is_some() {
        return Err(INVALID);
    }
    Ok(value)
}

struct RequestHeaders {
    path: &'static str,
    nonce: [u8; 32],
    tag: [u8; 32],
    length: usize,
}

fn parse_headers(bytes: &[u8], expected_host: &str) -> Result<RequestHeaders, HttpError> {
    // The transport deliberately accepts only one CRLF-framed HTTP/1.1 request.
    for (index, &byte) in bytes.iter().enumerate() {
        if (byte == b'\r' && bytes.get(index + 1) != Some(&b'\n'))
            || (byte == b'\n' && index.checked_sub(1).and_then(|i| bytes.get(i)) != Some(&b'\r'))
        {
            return Err(INVALID);
        }
    }
    let mut fields = [httparse::EMPTY_HEADER; 24];
    let mut parsed = httparse::Request::new(&mut fields);
    if parsed.parse(bytes) != Ok(httparse::Status::Complete(bytes.len()))
        || parsed.method != Some("POST")
        || parsed.version != Some(1)
    {
        return Err(INVALID);
    }
    let path = match parsed.path {
        Some(ATTACH) => ATTACH,
        Some(REQUEST) => REQUEST,
        Some(RETRIEVAL_PREPARE) => RETRIEVAL_PREPARE,
        Some(SOURCE) => SOURCE,
        Some(DASHBOARD_READ) => DASHBOARD_READ,
        Some(DASHBOARD_TOPOLOGY) => DASHBOARD_TOPOLOGY,
        Some(RUNTIME_ATTACH) => RUNTIME_ATTACH,
        Some(RUNTIME_HEARTBEAT) => RUNTIME_HEARTBEAT,
        Some(RUNTIME_DETACH) => RUNTIME_DETACH,
        Some(RUNTIME_SCOPE) => RUNTIME_SCOPE,
        _ => return Err(INVALID),
    };
    let fields = parsed.headers;
    if header(fields, "Host")? != Some(expected_host.as_bytes())
        || ["Origin", "Cookie", "Sec-Fetch-Site"]
            .into_iter()
            .any(|name| header(fields, name).ok() != Some(None))
    {
        return Err(FORBIDDEN);
    }
    if ["Transfer-Encoding", "Expect", "Upgrade"]
        .into_iter()
        .any(|name| header(fields, name).ok() != Some(None))
        || !header(fields, "Content-Type")?
            .is_some_and(|value| value.eq_ignore_ascii_case(b"application/json"))
    {
        return Err(INVALID);
    }
    let length = header(fields, "Content-Length")?.ok_or(INVALID)?;
    if length.is_empty() || length.iter().any(|byte| !byte.is_ascii_digit()) {
        return Err(INVALID);
    }
    let length = std::str::from_utf8(length)
        .ok()
        .and_then(|length| length.parse::<usize>().ok())
        .ok_or(TOO_LARGE)?;
    if length > MAX_WIRE_BYTES {
        return Err(TOO_LARGE);
    }
    let tag = header(fields, "Authorization")?
        .and_then(|value| value.strip_prefix(b"Reliquary "))
        .and_then(decode_tag)
        .ok_or(UNAUTHENTICATED)?;
    let nonce: [u8; 32] = header(fields, "X-Reliquary-Nonce")?
        .and_then(|value| value.try_into().ok())
        .ok_or(UNAUTHENTICATED)?;
    if nonce.iter().any(|&byte| nibble(byte).is_none()) {
        return Err(UNAUTHENTICATED);
    }
    Ok(RequestHeaders {
        path,
        nonce,
        tag,
        length,
    })
}

pub(crate) fn read_request(
    stream: &mut TcpStream,
    accepted_at: Instant,
    expected_host: &str,
    key: &TransportKey,
) -> Result<HttpRequest, HttpError> {
    let deadline = accepted_at + READ_DEADLINE;
    let mut buffer = Vec::with_capacity(MAX_HEADER_BYTES);
    let mut scratch = [0; 4096];
    let header_end = loop {
        let remaining = MAX_HEADER_BYTES - buffer.len();
        if remaining == 0 {
            return Err(TOO_LARGE);
        }
        let limit = remaining.min(scratch.len());
        let count = read(stream, &mut scratch[..limit], deadline)?;
        if count == 0 {
            return Err(INVALID);
        }
        let search_from = buffer.len().saturating_sub(3);
        buffer.extend_from_slice(&scratch[..count]);
        if let Some(end) = buffer[search_from..]
            .windows(4)
            .position(|v| v == b"\r\n\r\n")
        {
            break search_from + end + 4;
        }
    };
    let RequestHeaders {
        path,
        nonce,
        tag,
        length,
    } = parse_headers(&buffer[..header_end], expected_host)?;
    let mut body = buffer.split_off(header_end);
    if body.len() > length {
        return Err(INVALID);
    }
    let mut offset = body.len();
    body.resize(length, 0);
    while offset < length {
        let count = read(stream, &mut body[offset..], deadline)?;
        if count == 0 {
            return Err(INVALID);
        }
        offset += count;
    }
    if !key.verify_request(path, &nonce, &body, &tag) {
        return Err(UNAUTHENTICATED);
    }
    Ok(HttpRequest { path, nonce, body })
}

pub(crate) fn write_response(
    stream: &mut TcpStream,
    response: HttpResponse,
    proof: Option<(&TransportKey, &[u8; 32])>,
) -> io::Result<()> {
    stream.set_write_timeout(Some(WRITE_TIMEOUT))?;
    let body = serde_json::to_vec(&response.body).map_err(io::Error::other)?;
    if body.len() > MAX_WIRE_BYTES {
        return Err(io::Error::other("wire_limit"));
    }
    let status = response.status;
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        408 => "Request Timeout",
        409 => "Conflict",
        413 => "Content Too Large",
        _ => "Service Unavailable",
    };
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n",
        body.len()
    )?;
    if let Some((key, nonce)) = proof {
        write!(
            stream,
            "X-Reliquary-Proof: {}\r\n",
            key.response_proof(nonce, status, &body)
        )?;
    }
    stream.write_all(b"\r\n")?;
    stream.write_all(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authentication_binds_instance_route_nonce_status_and_exact_body() {
        let key = TransportKey::derive("example-token-used-only-in-tests", "instance", "lease");
        let nonce = *b"11111111111111111111111111111111";
        let body = br#"{"x":1}"#;
        let tag: [u8; 32] = mac(&key.0, &[b"request\0/v1/attach\0", &nonce, b"\0", body])
            .as_ref()
            .try_into()
            .unwrap();
        assert!(key.verify_request(ATTACH, &nonce, body, &tag));
        assert!(!key.verify_request(REQUEST, &nonce, body, &tag));
        assert!(!key.verify_request(ATTACH, &[b'2'; 32], body, &tag));
        assert!(!key.verify_request(ATTACH, &nonce, br#"{"x":2}"#, &tag));
        let changed = TransportKey::derive("example-token-used-only-in-tests", "instance", "other");
        assert!(!changed.verify_request(ATTACH, &nonce, body, &tag));
        assert_ne!(
            key.response_proof(&nonce, 200, body),
            key.response_proof(&nonce, 403, body)
        );
    }

    #[test]
    fn framing_rejects_duplicate_auth_and_untrusted_origins() {
        let request = format!(
            "POST /v1/attach HTTP/1.1\r\nHost: 127.0.0.1:88\r\nAuthorization: Reliquary {}\r\nX-Reliquary-Nonce: {}\r\nContent-Type: application/json\r\nContent-Length: 2\r\n",
            "1".repeat(64),
            "2".repeat(32),
        );
        let with = |extra: &str| format!("{request}{extra}\r\n");
        assert!(parse_headers(with("").as_bytes(), "127.0.0.1:88").is_ok());
        for extra in [
            "Origin: null\r\n",
            "Transfer-Encoding: chunked\r\n",
            "Content-Length: 2\r\n",
            "Host: localhost\r\n",
            "Authorization: Reliquary x\r\n",
            "X-Reliquary-Nonce: x\r\n",
        ] {
            assert!(parse_headers(with(extra).as_bytes(), "127.0.0.1:88").is_err());
        }
        assert!(parse_headers(with("").as_bytes(), "127.0.0.1:90").is_err());
    }
}
