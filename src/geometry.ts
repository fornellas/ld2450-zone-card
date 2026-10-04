import type { Point } from "./polygon";

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distance from p to the segment a-b. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/**
 * Where to insert a new point p in a polygon: after the start of the closest edge within maxDistance, or at the end.
 * The closing edge (last to first point) counts once the polygon has 3 points.
 */
export function insertionIndex(points: Point[], p: Point, maxDistance: number): number {
  let best = points.length;
  let bestDistance = maxDistance;
  const edges = points.length >= 3 ? points.length : points.length - 1;
  for (let i = 0; i < edges; i++) {
    const d = distanceToSegment(p, points[i], points[(i + 1) % points.length]);
    if (d <= bestDistance) {
      bestDistance = d;
      best = i + 1;
    }
  }
  return best;
}

export function snap(p: Point, step: number): Point {
  if (step <= 0) return p;
  return { x: Math.round(p.x / step) * step + 0, y: Math.round(p.y / step) * step + 0 };
}
