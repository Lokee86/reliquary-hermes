//! Same-cut evidence for Root's checked supersession retirement.
use super::DashboardError;
use reliquary_memory::{
    GraphEdge, GraphNode, InspectionCut, InspectionItem, InspectionQuery, Instance, MemoryId,
    OwnerId, OwnerKind, RelationKind,
};

pub(super) fn successor(
    instance: &Instance,
    owner: OwnerId,
    kind: OwnerKind,
    original: MemoryId,
    cut: InspectionCut,
) -> Result<MemoryId, DashboardError> {
    let query = InspectionQuery::Neighbors {
        anchor: GraphNode::Memory(original.0),
    };
    let mut cursor = None;
    let mut successor = None;
    // Root admits offsets up to 4096, with at most 128 rows per page.
    for _ in 0..33 {
        let page = instance
            .inspect_owner(owner, kind, &query, cursor.as_ref(), 128)
            .map_err(DashboardError::product)?;
        if page.cut != cut {
            return Err(DashboardError::stale("owner_cut_changed"));
        }
        for item in page.items {
            let InspectionItem::Edge(edge) = item else {
                return Err(DashboardError::unavailable(
                    "unexpected_neighbor_projection",
                ));
            };
            if let Some(source) = successor_edge(&edge, original)?
                && successor.replace(source).is_some()
            {
                return Err(DashboardError::conflict("supersession_successor_ambiguous"));
            }
        }
        if page.truncated {
            break;
        }
        cursor = page.next;
        if cursor.is_none() {
            return successor
                .ok_or_else(|| DashboardError::conflict("supersession_successor_unavailable"));
        }
    }
    Err(DashboardError::unavailable("supersession_edges_truncated"))
}

fn successor_edge(
    edge: &GraphEdge,
    original: MemoryId,
) -> Result<Option<MemoryId>, DashboardError> {
    if !edge.active {
        return Ok(None);
    }
    if edge.kind == RelationKind::Supersedes
        && edge.target == GraphNode::Memory(original.0)
        && let GraphNode::Memory(source) = edge.source
    {
        return Ok(Some(MemoryId(source)));
    }
    Err(DashboardError::conflict(
        "retirement_blocked_active_relations",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use reliquary_memory::{GraphDirection, RelationOrigin};

    fn edge(kind: RelationKind, source: GraphNode, target: GraphNode) -> GraphEdge {
        GraphEdge {
            source,
            target,
            kind,
            origin: RelationOrigin::User,
            direction: Some(GraphDirection::Incoming),
            active: true,
            graph_version: 1,
        }
    }

    #[test]
    fn accepts_only_the_expected_successor_edge_for_retirement() {
        let original = MemoryId([1; 32]);
        let successor = MemoryId([2; 32]);
        let expected = edge(
            RelationKind::Supersedes,
            GraphNode::Memory(successor.0),
            GraphNode::Memory(original.0),
        );
        assert!(matches!(
            successor_edge(&expected, original),
            Ok(Some(actual)) if actual == successor
        ));

        let association = edge(
            RelationKind::Topical,
            GraphNode::Memory(successor.0),
            GraphNode::Memory(original.0),
        );
        assert_eq!(
            successor_edge(&association, original).unwrap_err().code,
            "retirement_blocked_active_relations",
        );

        let entity_reference = edge(
            RelationKind::EntityAssociation,
            GraphNode::Entity([3; 32]),
            GraphNode::Memory(original.0),
        );
        assert_eq!(
            successor_edge(&entity_reference, original)
                .unwrap_err()
                .code,
            "retirement_blocked_active_relations",
        );

        let mut inactive = association;
        inactive.active = false;
        assert!(matches!(successor_edge(&inactive, original), Ok(None)));
    }
}
