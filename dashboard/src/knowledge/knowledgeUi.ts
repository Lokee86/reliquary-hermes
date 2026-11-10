import type { Community } from "../../types";

export function shortId(id: string) {
  return id.length > 10 ? id.slice(0, 8) : id;
}

export function communityLabel(community: Community | string) {
  if (typeof community === "string") return `Community ${shortId(community)}`;
  return community.name || `Community ${shortId(community.community_id)}`;
}

export function relationLabel(kind: string) {
  return kind.replaceAll("_", " ");
}
