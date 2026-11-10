import type { GraphRenderBounds, GraphRenderVec3 } from "./types";

interface Entry<T> {
  bounds: GraphRenderBounds;
  value: T;
}

type IndexNode<T> =
  | { bounds: GraphRenderBounds; entries: Entry<T>[] }
  | { bounds: GraphRenderBounds; left: IndexNode<T>; right: IndexNode<T> };

const LEAF_SIZE = 8;

interface RayQueueItem<T> {
  distance: number;
  node?: IndexNode<T>;
  entry?: Entry<T>;
}

export class GraphRenderBoundsIndex<T> {
  private readonly root: IndexNode<T> | null;

  constructor(entries: readonly Entry<T>[]) {
    this.root = entries.length > 0 ? build(entries.slice()) : null;
  }

  querySphere(center: GraphRenderVec3, radius: number, limit: number): T[] {
    if (!this.root || limit <= 0 || radius < 0) return [];
    const result: T[] = [];
    visit(this.root, center, radius * radius, limit, result);
    return result;
  }

  queryRay(
    origin: GraphRenderVec3,
    direction: GraphRenderVec3,
    limit: number,
  ): T[] {
    if (!this.root || limit <= 0) return [];
    const rootDistance = rayDistance(this.root.bounds, origin, direction);
    if (rootDistance === null) return [];

    const queue: RayQueueItem<T>[] = [{
      distance: rootDistance,
      node: this.root,
    }];
    const result: T[] = [];

    while (queue.length > 0 && result.length < limit) {
      queue.sort((left, right) => left.distance - right.distance);
      const current = queue.shift()!;
      if (current.entry) {
        result.push(current.entry.value);
        continue;
      }

      const node = current.node!;
      if ("entries" in node) {
        for (const entry of node.entries) {
          const distance = rayDistance(entry.bounds, origin, direction);
          if (distance !== null) queue.push({ distance, entry });
        }
      } else {
        for (const child of [node.left, node.right]) {
          const distance = rayDistance(child.bounds, origin, direction);
          if (distance !== null) queue.push({ distance, node: child });
        }
      }
    }

    return result;
  }
}

function build<T>(entries: Entry<T>[]): IndexNode<T> {
  const bounds = unionAll(entries.map((entry) => entry.bounds));
  if (entries.length <= LEAF_SIZE) return { bounds, entries };

  const axis = longestAxis(bounds);
  entries.sort((left, right) => center(left.bounds, axis) - center(right.bounds, axis));
  const middle = Math.floor(entries.length / 2);
  return {
    bounds,
    left: build(entries.slice(0, middle)),
    right: build(entries.slice(middle)),
  };
}

function visit<T>(
  node: IndexNode<T>,
  centerPoint: GraphRenderVec3,
  radiusSquared: number,
  limit: number,
  result: T[],
) {
  if (result.length >= limit || distanceSquared(node.bounds, centerPoint) > radiusSquared) return;

  if ("entries" in node) {
    for (const entry of node.entries) {
      if (result.length >= limit) return;
      if (distanceSquared(entry.bounds, centerPoint) <= radiusSquared) result.push(entry.value);
    }
    return;
  }

  const leftDistance = distanceSquared(node.left.bounds, centerPoint);
  const rightDistance = distanceSquared(node.right.bounds, centerPoint);
  if (leftDistance <= rightDistance) {
    visit(node.left, centerPoint, radiusSquared, limit, result);
    visit(node.right, centerPoint, radiusSquared, limit, result);
  } else {
    visit(node.right, centerPoint, radiusSquared, limit, result);
    visit(node.left, centerPoint, radiusSquared, limit, result);
  }
}

function distanceSquared(bounds: GraphRenderBounds, point: GraphRenderVec3) {
  let total = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const value = point[axis];
    const delta = value < bounds.min[axis]
      ? bounds.min[axis] - value
      : value > bounds.max[axis]
        ? value - bounds.max[axis]
        : 0;
    total += delta * delta;
  }
  return total;
}

function rayDistance(
  bounds: GraphRenderBounds,
  origin: GraphRenderVec3,
  direction: GraphRenderVec3,
) {
  let near = 0;
  let far = Number.POSITIVE_INFINITY;

  for (let axis = 0; axis < 3; axis += 1) {
    const delta = direction[axis];
    if (Math.abs(delta) < 1e-12) {
      if (origin[axis] < bounds.min[axis] || origin[axis] > bounds.max[axis]) {
        return null;
      }
      continue;
    }

    let first = (bounds.min[axis] - origin[axis]) / delta;
    let second = (bounds.max[axis] - origin[axis]) / delta;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (far < near) return null;
  }

  return far >= 0 ? Math.max(0, near) : null;
}

function longestAxis(bounds: GraphRenderBounds) {
  const spans = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
  return spans[1] > spans[0] ? (spans[2] > spans[1] ? 2 : 1) : (spans[2] > spans[0] ? 2 : 0);
}

function center(bounds: GraphRenderBounds, axis: number) {
  return (bounds.min[axis] + bounds.max[axis]) * 0.5;
}

function unionAll(bounds: GraphRenderBounds[]): GraphRenderBounds {
  const first = bounds[0];
  const min: [number, number, number] = [...first.min];
  const max: [number, number, number] = [...first.max];
  for (const item of bounds.slice(1)) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], item.min[axis]);
      max[axis] = Math.max(max[axis], item.max[axis]);
    }
  }
  return { min, max };
}
