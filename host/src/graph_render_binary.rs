use std::fmt;

pub(crate) const GRAPH_RENDER_BINARY_SCHEMA_VERSION: u16 = 1;
pub(crate) const GRAPH_RENDER_BINARY_HEADER_LEN: usize = 32;
pub(crate) const GRAPH_RENDER_NODE_MAGIC: [u8; 8] = *b"WRNODE\0\0";
pub(crate) const GRAPH_RENDER_EDGE_MAGIC: [u8; 8] = *b"WREDGE\0\0";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct GraphRenderBinaryHeader {
    pub(crate) generation_id: u64,
    pub(crate) payload_id: u32,
    pub(crate) item_count: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum GraphRenderBinaryError {
    ArrayLengthMismatch,
    LengthOverflow,
    InvalidLength { expected: usize, actual: usize },
    InvalidMagic,
    UnsupportedVersion(u16),
    InvalidHeaderLength(u16),
    UnsupportedFlags(u32),
}

impl fmt::Display for GraphRenderBinaryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ArrayLengthMismatch => {
                write!(formatter, "graph render payload arrays differ in length")
            }
            Self::LengthOverflow => write!(
                formatter,
                "graph render payload length exceeds addressable range"
            ),
            Self::InvalidLength { expected, actual } => {
                write!(
                    formatter,
                    "graph render payload length is {actual}, expected {expected}"
                )
            }
            Self::InvalidMagic => write!(formatter, "graph render payload magic is invalid"),
            Self::UnsupportedVersion(version) => {
                write!(
                    formatter,
                    "graph render payload version {version} is unsupported"
                )
            }
            Self::InvalidHeaderLength(length) => {
                write!(
                    formatter,
                    "graph render payload header length {length} is invalid"
                )
            }
            Self::UnsupportedFlags(flags) => {
                write!(
                    formatter,
                    "graph render payload flags {flags:#x} are unsupported"
                )
            }
        }
    }
}

impl std::error::Error for GraphRenderBinaryError {}

pub(crate) fn encoded_len(
    item_count: usize,
    bytes_per_item: usize,
) -> Result<usize, GraphRenderBinaryError> {
    item_count
        .checked_mul(bytes_per_item)
        .and_then(|body| GRAPH_RENDER_BINARY_HEADER_LEN.checked_add(body))
        .ok_or(GraphRenderBinaryError::LengthOverflow)
}

pub(crate) fn encode_header(target: &mut Vec<u8>, magic: [u8; 8], header: GraphRenderBinaryHeader) {
    target.extend_from_slice(&magic);
    target.extend_from_slice(&GRAPH_RENDER_BINARY_SCHEMA_VERSION.to_le_bytes());
    target.extend_from_slice(&(GRAPH_RENDER_BINARY_HEADER_LEN as u16).to_le_bytes());
    target.extend_from_slice(&0_u32.to_le_bytes());
    target.extend_from_slice(&header.generation_id.to_le_bytes());
    target.extend_from_slice(&header.payload_id.to_le_bytes());
    target.extend_from_slice(&header.item_count.to_le_bytes());
}

pub(crate) fn rebind_payload_header(bytes: &[u8], generation_id: u64, payload_id: u32) -> Vec<u8> {
    debug_assert!(bytes.len() >= GRAPH_RENDER_BINARY_HEADER_LEN);
    let mut rebound = bytes.to_vec();
    rebound[16..24].copy_from_slice(&generation_id.to_le_bytes());
    rebound[24..28].copy_from_slice(&payload_id.to_le_bytes());
    rebound
}

pub(crate) fn decode_header(
    bytes: &[u8],
    magic: [u8; 8],
) -> Result<GraphRenderBinaryHeader, GraphRenderBinaryError> {
    if bytes.len() < GRAPH_RENDER_BINARY_HEADER_LEN {
        return Err(GraphRenderBinaryError::InvalidLength {
            expected: GRAPH_RENDER_BINARY_HEADER_LEN,
            actual: bytes.len(),
        });
    }
    if bytes[0..8] != magic {
        return Err(GraphRenderBinaryError::InvalidMagic);
    }
    let version = u16::from_le_bytes([bytes[8], bytes[9]]);
    if version != GRAPH_RENDER_BINARY_SCHEMA_VERSION {
        return Err(GraphRenderBinaryError::UnsupportedVersion(version));
    }
    let header_len = u16::from_le_bytes([bytes[10], bytes[11]]);
    if header_len as usize != GRAPH_RENDER_BINARY_HEADER_LEN {
        return Err(GraphRenderBinaryError::InvalidHeaderLength(header_len));
    }
    let flags = read_u32(bytes, 12);
    if flags != 0 {
        return Err(GraphRenderBinaryError::UnsupportedFlags(flags));
    }
    Ok(GraphRenderBinaryHeader {
        generation_id: read_u64(bytes, 16),
        payload_id: read_u32(bytes, 24),
        item_count: read_u32(bytes, 28),
    })
}

pub(crate) fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(
        bytes[offset..offset + 4]
            .try_into()
            .expect("validated payload"),
    )
}

pub(crate) fn read_u64(bytes: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(
        bytes[offset..offset + 8]
            .try_into()
            .expect("validated payload"),
    )
}

pub(crate) fn read_f32(bytes: &[u8], offset: usize) -> f32 {
    f32::from_le_bytes(
        bytes[offset..offset + 4]
            .try_into()
            .expect("validated payload"),
    )
}
