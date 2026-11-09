//! Same-cut evidence for Root's checked supersession retirement.
use super::DashboardError;
use reliquary_memory::{
    GraphNode, InspectionCut, InspectionItem, InspectionQuery, Instance, MemoryId, OwnerId,
    OwnerKind, RelationKind,
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
            if let (
                true,
                RelationKind::Supersedes,
                GraphNode::Memory(source),
                GraphNode::Memory(target),
            ) = (edge.active, edge.kind, edge.source, edge.target)
            {
                if target == original.0 && successor.replace(MemoryId(source)).is_some() {
                    return Err(DashboardError::conflict("supersession_successor_ambiguous"));
                }
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
