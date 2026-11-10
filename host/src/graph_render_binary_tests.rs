use crate::graph_render_binary::{
    GRAPH_RENDER_BINARY_HEADER_LEN, GRAPH_RENDER_BINARY_SCHEMA_VERSION, GraphRenderBinaryError,
};
use crate::graph_render_edge_chunk::{
    GRAPH_RENDER_EDGE_BYTES_PER_ITEM, GraphRenderEdgeChunk, graph_render_edge_chunk_len,
};
use crate::graph_render_identity::RenderNodeId;
use crate::graph_render_node_chunk::{
    GRAPH_RENDER_NODE_BYTES_PER_ITEM, GraphRenderNodeChunk, graph_render_node_chunk_len,
};

#[test]
fn node_chunk_round_trips_with_frozen_byte_cost() {
    let chunk = GraphRenderNodeChunk {
        generation_id: 55,
        chunk_id: 7,
        positions: vec![[1.0, 2.0, 3.0], [-4.0, 5.5, 6.25]],
        packed_colors: vec![0x1122_3344, 0xaabb_ccdd],
        sizes: vec![1.5, 2.5],
        render_ids: vec![RenderNodeId::new(9), RenderNodeId::new(11)],
    };

    let encoded = chunk.encode().unwrap();

    assert_eq!(
        encoded.len(),
        GRAPH_RENDER_BINARY_HEADER_LEN + 2 * GRAPH_RENDER_NODE_BYTES_PER_ITEM,
    );
    assert_eq!(encoded, chunk.encode().unwrap());
    assert_eq!(GraphRenderNodeChunk::decode(&encoded).unwrap(), chunk);
}

#[test]
fn edge_chunk_round_trips_with_frozen_byte_cost() {
    let chunk = GraphRenderEdgeChunk {
        generation_id: 88,
        chunk_id: 12,
        endpoints: vec![
            [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]],
            [[-1.0, -2.0, -3.0], [0.25, 0.5, 0.75]],
        ],
        weights: vec![3.5, 8.0],
        packed_colors: vec![0x0102_0304, 0xf0e0_d0c0],
    };

    let encoded = chunk.encode().unwrap();

    assert_eq!(
        encoded.len(),
        GRAPH_RENDER_BINARY_HEADER_LEN + 2 * GRAPH_RENDER_EDGE_BYTES_PER_ITEM,
    );
    assert_eq!(encoded, chunk.encode().unwrap());
    assert_eq!(GraphRenderEdgeChunk::decode(&encoded).unwrap(), chunk);
}

#[test]
fn payload_headers_are_little_endian_and_32_bytes() {
    let chunk = GraphRenderNodeChunk {
        generation_id: 0x0102_0304_0506_0708,
        chunk_id: 0x1122_3344,
        positions: vec![],
        packed_colors: vec![],
        sizes: vec![],
        render_ids: vec![],
    };
    let encoded = chunk.encode().unwrap();

    assert_eq!(&encoded[0..8], b"WRNODE\0\0");
    assert_eq!(
        &encoded[8..10],
        &GRAPH_RENDER_BINARY_SCHEMA_VERSION.to_le_bytes(),
    );
    assert_eq!(&encoded[10..12], &(32_u16).to_le_bytes());
    assert_eq!(&encoded[12..16], &[0, 0, 0, 0]);
    assert_eq!(&encoded[16..24], &0x0102_0304_0506_0708_u64.to_le_bytes());
    assert_eq!(&encoded[24..28], &0x1122_3344_u32.to_le_bytes());
    assert_eq!(&encoded[28..32], &0_u32.to_le_bytes());
}

#[test]
fn binary_decoders_reject_wrong_kind_version_and_length() {
    let chunk = GraphRenderNodeChunk {
        generation_id: 1,
        chunk_id: 2,
        positions: vec![[0.0, 0.0, 0.0]],
        packed_colors: vec![0],
        sizes: vec![1.0],
        render_ids: vec![RenderNodeId::new(0)],
    };
    let encoded = chunk.encode().unwrap();

    assert_eq!(
        GraphRenderEdgeChunk::decode(&encoded),
        Err(GraphRenderBinaryError::InvalidMagic),
    );

    let mut bad_version = encoded.clone();
    bad_version[8..10].copy_from_slice(&2_u16.to_le_bytes());
    assert_eq!(
        GraphRenderNodeChunk::decode(&bad_version),
        Err(GraphRenderBinaryError::UnsupportedVersion(2)),
    );

    let mut bad_header_len = encoded.clone();
    bad_header_len[10..12].copy_from_slice(&31_u16.to_le_bytes());
    assert_eq!(
        GraphRenderNodeChunk::decode(&bad_header_len),
        Err(GraphRenderBinaryError::InvalidHeaderLength(31)),
    );

    let mut bad_flags = encoded.clone();
    bad_flags[12..16].copy_from_slice(&1_u32.to_le_bytes());
    assert_eq!(
        GraphRenderNodeChunk::decode(&bad_flags),
        Err(GraphRenderBinaryError::UnsupportedFlags(1)),
    );

    let mut truncated = encoded.clone();
    truncated.pop();
    assert_eq!(
        GraphRenderNodeChunk::decode(&truncated),
        Err(GraphRenderBinaryError::InvalidLength {
            expected: encoded.len(),
            actual: encoded.len() - 1,
        }),
    );

    let mut trailing = encoded.clone();
    trailing.push(0);
    assert_eq!(
        GraphRenderNodeChunk::decode(&trailing),
        Err(GraphRenderBinaryError::InvalidLength {
            expected: encoded.len(),
            actual: encoded.len() + 1,
        }),
    );
}

#[test]
fn encoders_reject_parallel_array_mismatch() {
    let nodes = GraphRenderNodeChunk {
        generation_id: 1,
        chunk_id: 2,
        positions: vec![[0.0, 0.0, 0.0]],
        packed_colors: vec![],
        sizes: vec![1.0],
        render_ids: vec![RenderNodeId::new(0)],
    };
    assert_eq!(
        nodes.encode(),
        Err(GraphRenderBinaryError::ArrayLengthMismatch),
    );

    let edges = GraphRenderEdgeChunk {
        generation_id: 1,
        chunk_id: 2,
        endpoints: vec![[[0.0, 0.0, 0.0], [1.0, 1.0, 1.0]]],
        weights: vec![],
        packed_colors: vec![0],
    };
    assert_eq!(
        edges.encode(),
        Err(GraphRenderBinaryError::ArrayLengthMismatch),
    );
}

#[test]
fn encoded_length_helpers_freeze_per_item_costs() {
    assert_eq!(graph_render_node_chunk_len(0).unwrap(), 32);
    assert_eq!(graph_render_node_chunk_len(1).unwrap(), 56);
    assert_eq!(graph_render_node_chunk_len(1_000).unwrap(), 24_032);

    assert_eq!(graph_render_edge_chunk_len(0).unwrap(), 32);
    assert_eq!(graph_render_edge_chunk_len(1).unwrap(), 64);
    assert_eq!(graph_render_edge_chunk_len(1_000).unwrap(), 32_032);
    assert_eq!(
        graph_render_node_chunk_len(usize::MAX),
        Err(GraphRenderBinaryError::LengthOverflow),
    );
}
