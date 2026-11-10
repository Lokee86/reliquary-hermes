use crate::graph_render_binary::GRAPH_RENDER_BINARY_HEADER_LEN;
use crate::graph_render_edge_chunk::GraphRenderEdgeChunk;
use crate::graph_render_identity::RenderNodeId;
use crate::graph_render_node_chunk::GraphRenderNodeChunk;

#[test]
fn node_chunk_structure_of_arrays_offsets_are_frozen() {
    let chunk = GraphRenderNodeChunk {
        generation_id: 1,
        chunk_id: 2,
        positions: vec![[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]],
        packed_colors: vec![0x1122_3344, 0x5566_7788],
        sizes: vec![7.0, 8.0],
        render_ids: vec![RenderNodeId::new(9), RenderNodeId::new(10)],
    };
    let bytes = chunk.encode().unwrap();

    let positions = GRAPH_RENDER_BINARY_HEADER_LEN;
    let colors = positions + 2 * 12;
    let sizes = colors + 2 * 4;
    let render_ids = sizes + 2 * 4;

    assert_eq!(&bytes[positions..positions + 4], &1.0_f32.to_le_bytes());
    assert_eq!(
        &bytes[positions + 12..positions + 16],
        &4.0_f32.to_le_bytes()
    );
    assert_eq!(&bytes[colors..colors + 4], &0x1122_3344_u32.to_le_bytes());
    assert_eq!(
        &bytes[colors + 4..colors + 8],
        &0x5566_7788_u32.to_le_bytes()
    );
    assert_eq!(&bytes[sizes..sizes + 4], &7.0_f32.to_le_bytes());
    assert_eq!(&bytes[sizes + 4..sizes + 8], &8.0_f32.to_le_bytes());
    assert_eq!(&bytes[render_ids..render_ids + 4], &9_u32.to_le_bytes());
    assert_eq!(
        &bytes[render_ids + 4..render_ids + 8],
        &10_u32.to_le_bytes()
    );
    assert_eq!(bytes.len(), render_ids + 8);
}

#[test]
fn edge_chunk_structure_of_arrays_offsets_are_frozen() {
    let chunk = GraphRenderEdgeChunk {
        generation_id: 1,
        chunk_id: 2,
        endpoints: vec![
            [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]],
            [[7.0, 8.0, 9.0], [10.0, 11.0, 12.0]],
        ],
        weights: vec![13.0, 14.0],
        packed_colors: vec![0xaabb_ccdd, 0x1020_3040],
    };
    let bytes = chunk.encode().unwrap();

    let endpoints = GRAPH_RENDER_BINARY_HEADER_LEN;
    let weights = endpoints + 2 * 24;
    let colors = weights + 2 * 4;

    assert_eq!(&bytes[endpoints..endpoints + 4], &1.0_f32.to_le_bytes());
    assert_eq!(
        &bytes[endpoints + 24..endpoints + 28],
        &7.0_f32.to_le_bytes()
    );
    assert_eq!(&bytes[weights..weights + 4], &13.0_f32.to_le_bytes());
    assert_eq!(&bytes[weights + 4..weights + 8], &14.0_f32.to_le_bytes());
    assert_eq!(&bytes[colors..colors + 4], &0xaabb_ccdd_u32.to_le_bytes());
    assert_eq!(
        &bytes[colors + 4..colors + 8],
        &0x1020_3040_u32.to_le_bytes()
    );
    assert_eq!(bytes.len(), colors + 8);
}
