use crate::graph_render_contract::{
    GRAPH_RENDER_MANIFEST_SCHEMA_VERSION, GraphRenderBounds, GraphRenderEdgeChunkDescriptor,
    GraphRenderEdgeLod, GraphRenderHierarchyDescriptor, GraphRenderHierarchyKind,
    GraphRenderLabelCandidateDescriptor, GraphRenderManifest, GraphRenderNodeChunkDescriptor,
    decimal_u64,
};

#[test]
fn manifest_serializes_stable_camel_case_contract() {
    let bounds = GraphRenderBounds::new([-1.0, -2.0, -3.0], [1.0, 2.0, 3.0]);
    let manifest = GraphRenderManifest {
        schema_version: GRAPH_RENDER_MANIFEST_SCHEMA_VERSION,
        generation_id: decimal_u64(u64::MAX),
        owner_id: "rel-owner".to_owned(),
        source_community_generation: Some(decimal_u64(9_007_199_254_740_993)),
        total_node_count: 3,
        root_hierarchy_id: 10,
        global_bounds: bounds,
        hierarchy: vec![GraphRenderHierarchyDescriptor {
            id: 10,
            parent_id: None,
            kind: GraphRenderHierarchyKind::Graph,
            bounds,
            node_count: 3,
            chunk_id: None,
        }],
        node_chunks: vec![GraphRenderNodeChunkDescriptor {
            chunk_id: 20,
            parent_hierarchy_id: 10,
            bounds,
            node_count: 3,
            byte_len: 104,
            label_candidates: vec![GraphRenderLabelCandidateDescriptor {
                render_id: 2,
                item_index: 1,
                importance: 7,
                label: "Important".into(),
            }],
        }],
        edge_chunks: vec![GraphRenderEdgeChunkDescriptor {
            chunk_id: 30,
            lod: GraphRenderEdgeLod::Overview,
            bounds,
            segment_count: 2,
            byte_len: 96,
        }],
    };

    let value = serde_json::to_value(manifest).unwrap();

    assert_eq!(value["schemaVersion"], 2);
    assert_eq!(value["generationId"], u64::MAX.to_string());
    assert_eq!(value["sourceCommunityGeneration"], "9007199254740993");
    assert_eq!(value["hierarchy"][0]["kind"], "graph");
    assert_eq!(value["edgeChunks"][0]["lod"], "overview");
    assert_eq!(value["nodeChunks"][0]["labelCandidates"][0]["renderId"], 2);
    assert_eq!(
        value["nodeChunks"][0]["labelCandidates"][0]["label"],
        "Important"
    );
    assert!(value.get("generation_id").is_none());
}

#[test]
fn manifest_enums_cover_the_frozen_hierarchy_and_edge_lod_levels() {
    let hierarchy = [
        GraphRenderHierarchyKind::Graph,
        GraphRenderHierarchyKind::Territory,
        GraphRenderHierarchyKind::Subgroup,
        GraphRenderHierarchyKind::Leaf,
    ];
    let edge_lods = [
        GraphRenderEdgeLod::Overview,
        GraphRenderEdgeLod::Intermediate,
        GraphRenderEdgeLod::Detail,
    ];

    assert_eq!(
        serde_json::to_value(hierarchy).unwrap(),
        serde_json::json!(["graph", "territory", "subgroup", "leaf"]),
    );
    assert_eq!(
        serde_json::to_value(edge_lods).unwrap(),
        serde_json::json!(["overview", "intermediate", "detail"]),
    );
}
