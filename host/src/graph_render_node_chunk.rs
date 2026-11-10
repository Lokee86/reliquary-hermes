use crate::graph_render_binary::{
    GRAPH_RENDER_BINARY_HEADER_LEN, GRAPH_RENDER_NODE_MAGIC, GraphRenderBinaryError,
    GraphRenderBinaryHeader, decode_header, encode_header, encoded_len, read_f32, read_u32,
};
use crate::graph_render_identity::RenderNodeId;

pub(crate) const GRAPH_RENDER_NODE_BYTES_PER_ITEM: usize = 24;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GraphRenderNodeChunk {
    pub(crate) generation_id: u64,
    pub(crate) chunk_id: u32,
    pub(crate) positions: Vec<[f32; 3]>,
    pub(crate) packed_colors: Vec<u32>,
    pub(crate) sizes: Vec<f32>,
    pub(crate) render_ids: Vec<RenderNodeId>,
}

impl GraphRenderNodeChunk {
    pub(crate) fn encode(&self) -> Result<Vec<u8>, GraphRenderBinaryError> {
        let count = self.positions.len();
        if self.packed_colors.len() != count
            || self.sizes.len() != count
            || self.render_ids.len() != count
        {
            return Err(GraphRenderBinaryError::ArrayLengthMismatch);
        }
        let item_count =
            u32::try_from(count).map_err(|_| GraphRenderBinaryError::LengthOverflow)?;
        let capacity = graph_render_node_chunk_len(count)?;
        let mut bytes = Vec::with_capacity(capacity);
        encode_header(
            &mut bytes,
            GRAPH_RENDER_NODE_MAGIC,
            GraphRenderBinaryHeader {
                generation_id: self.generation_id,
                payload_id: self.chunk_id,
                item_count,
            },
        );
        for position in &self.positions {
            for coordinate in position {
                bytes.extend_from_slice(&coordinate.to_le_bytes());
            }
        }
        for color in &self.packed_colors {
            bytes.extend_from_slice(&color.to_le_bytes());
        }
        for size in &self.sizes {
            bytes.extend_from_slice(&size.to_le_bytes());
        }
        for render_id in &self.render_ids {
            bytes.extend_from_slice(&render_id.get().to_le_bytes());
        }
        debug_assert_eq!(bytes.len(), capacity);
        Ok(bytes)
    }

    pub(crate) fn decode(bytes: &[u8]) -> Result<Self, GraphRenderBinaryError> {
        let header = decode_header(bytes, GRAPH_RENDER_NODE_MAGIC)?;
        let count = header.item_count as usize;
        let expected = graph_render_node_chunk_len(count)?;
        if bytes.len() != expected {
            return Err(GraphRenderBinaryError::InvalidLength {
                expected,
                actual: bytes.len(),
            });
        }

        let mut offset = GRAPH_RENDER_BINARY_HEADER_LEN;
        let mut positions = Vec::with_capacity(count);
        for _ in 0..count {
            positions.push([
                read_f32(bytes, offset),
                read_f32(bytes, offset + 4),
                read_f32(bytes, offset + 8),
            ]);
            offset += 12;
        }

        let mut packed_colors = Vec::with_capacity(count);
        for _ in 0..count {
            packed_colors.push(read_u32(bytes, offset));
            offset += 4;
        }

        let mut sizes = Vec::with_capacity(count);
        for _ in 0..count {
            sizes.push(read_f32(bytes, offset));
            offset += 4;
        }

        let mut render_ids = Vec::with_capacity(count);
        for _ in 0..count {
            render_ids.push(RenderNodeId::new(read_u32(bytes, offset)));
            offset += 4;
        }

        Ok(Self {
            generation_id: header.generation_id,
            chunk_id: header.payload_id,
            positions,
            packed_colors,
            sizes,
            render_ids,
        })
    }
}

pub(crate) fn graph_render_node_chunk_len(
    node_count: usize,
) -> Result<usize, GraphRenderBinaryError> {
    encoded_len(node_count, GRAPH_RENDER_NODE_BYTES_PER_ITEM)
}
