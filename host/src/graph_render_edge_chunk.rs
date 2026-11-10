use crate::graph_render_binary::{
    GRAPH_RENDER_BINARY_HEADER_LEN, GRAPH_RENDER_EDGE_MAGIC, GraphRenderBinaryError,
    GraphRenderBinaryHeader, decode_header, encode_header, encoded_len, read_f32, read_u32,
};

pub(crate) const GRAPH_RENDER_EDGE_BYTES_PER_ITEM: usize = 32;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GraphRenderEdgeChunk {
    pub(crate) generation_id: u64,
    pub(crate) chunk_id: u32,
    pub(crate) endpoints: Vec<[[f32; 3]; 2]>,
    pub(crate) weights: Vec<f32>,
    pub(crate) packed_colors: Vec<u32>,
}

impl GraphRenderEdgeChunk {
    pub(crate) fn encode(&self) -> Result<Vec<u8>, GraphRenderBinaryError> {
        let count = self.endpoints.len();
        if self.weights.len() != count || self.packed_colors.len() != count {
            return Err(GraphRenderBinaryError::ArrayLengthMismatch);
        }
        let item_count =
            u32::try_from(count).map_err(|_| GraphRenderBinaryError::LengthOverflow)?;
        let capacity = graph_render_edge_chunk_len(count)?;
        let mut bytes = Vec::with_capacity(capacity);
        encode_header(
            &mut bytes,
            GRAPH_RENDER_EDGE_MAGIC,
            GraphRenderBinaryHeader {
                generation_id: self.generation_id,
                payload_id: self.chunk_id,
                item_count,
            },
        );
        for endpoints in &self.endpoints {
            for point in endpoints {
                for coordinate in point {
                    bytes.extend_from_slice(&coordinate.to_le_bytes());
                }
            }
        }
        for weight in &self.weights {
            bytes.extend_from_slice(&weight.to_le_bytes());
        }
        for color in &self.packed_colors {
            bytes.extend_from_slice(&color.to_le_bytes());
        }
        debug_assert_eq!(bytes.len(), capacity);
        Ok(bytes)
    }

    pub(crate) fn decode(bytes: &[u8]) -> Result<Self, GraphRenderBinaryError> {
        let header = decode_header(bytes, GRAPH_RENDER_EDGE_MAGIC)?;
        let count = header.item_count as usize;
        let expected = graph_render_edge_chunk_len(count)?;
        if bytes.len() != expected {
            return Err(GraphRenderBinaryError::InvalidLength {
                expected,
                actual: bytes.len(),
            });
        }

        let mut offset = GRAPH_RENDER_BINARY_HEADER_LEN;
        let mut endpoints = Vec::with_capacity(count);
        for _ in 0..count {
            endpoints.push([
                [
                    read_f32(bytes, offset),
                    read_f32(bytes, offset + 4),
                    read_f32(bytes, offset + 8),
                ],
                [
                    read_f32(bytes, offset + 12),
                    read_f32(bytes, offset + 16),
                    read_f32(bytes, offset + 20),
                ],
            ]);
            offset += 24;
        }

        let mut weights = Vec::with_capacity(count);
        for _ in 0..count {
            weights.push(read_f32(bytes, offset));
            offset += 4;
        }

        let mut packed_colors = Vec::with_capacity(count);
        for _ in 0..count {
            packed_colors.push(read_u32(bytes, offset));
            offset += 4;
        }

        Ok(Self {
            generation_id: header.generation_id,
            chunk_id: header.payload_id,
            endpoints,
            weights,
            packed_colors,
        })
    }
}

pub(crate) fn graph_render_edge_chunk_len(
    edge_count: usize,
) -> Result<usize, GraphRenderBinaryError> {
    encoded_len(edge_count, GRAPH_RENDER_EDGE_BYTES_PER_ITEM)
}
