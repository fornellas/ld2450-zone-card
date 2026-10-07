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

/** Whether p is inside the polygon (even-odd rule) or on its edge, within tolerance. */
export function insidePolygon(p: Point, polygon: Point[], tolerance = 1): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (distanceToSegment(p, a, b) <= tolerance) return true;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Edge directions of the perimeter: every 11.25°
const PERIMETER_DIRECTIONS = 32;
// Perimeter edges shorter than this, in mm, are dropped, so points don't bunch up
const MIN_PERIMETER_EDGE = 150;
// Most points a perimeter has: the device takes 23, and clipping it to a rectangle can add up to 4
export const MAX_PERIMETER_POINTS = 19;

/**
 * A convex polygon around the points, keeping every point at least margin inside it. Its edges point in fixed
 * directions, every 11.25°, each as close as the margin allows. Edges that would be very short are left out, and so
 * are the shortest ones while there are more than MAX_PERIMETER_POINTS; leaving edges out only makes the polygon
 * bigger. Its vertices go counter-clockwise.
 */
export function perimeter(points: Point[], margin: number): Point[] {
  if (points.length === 0) return [];
  // Each edge lies on n·p = support: as far out as the farthest point in that direction, plus the margin
  const edges = Array.from({ length: PERIMETER_DIRECTIONS }, (_, k) => {
    const a = (2 * Math.PI * k) / PERIMETER_DIRECTIONS;
    const n = { x: Math.cos(a), y: Math.sin(a) };
    return { k, n, support: Math.max(...points.map((p) => n.x * p.x + n.y * p.y)) + margin };
  });
  const corner = (a: (typeof edges)[number], b: (typeof edges)[number]): Point => {
    const det = a.n.x * b.n.y - a.n.y * b.n.x;
    return {
      x: (a.support * b.n.y - b.support * a.n.y) / det,
      y: (a.n.x * b.support - b.n.x * a.support) / det,
    };
  };
  // Vertex i is where edge i meets edge i + 1, so edge i runs from vertex i - 1 to vertex i
  const vertices = () => edges.map((e, i) => corner(e, edges[(i + 1) % edges.length]));
  for (;;) {
    const v = vertices();
    let shortest = -1;
    // Too many points: leave out the shortest edge, however long
    let shortestLength = edges.length > MAX_PERIMETER_POINTS ? Number.POSITIVE_INFINITY : MIN_PERIMETER_EDGE;
    edges.forEach((_, i) => {
      const previous = edges[(i + edges.length - 1) % edges.length];
      const next = edges[(i + 1) % edges.length];
      // Leaving an edge out joins its neighbours; keep them at most 90° apart, so corners are never sharper than
      // right angles and the polygon only grows by about the edge's length
      const gap = (next.k - previous.k + PERIMETER_DIRECTIONS) % PERIMETER_DIRECTIONS;
      if (gap > PERIMETER_DIRECTIONS / 4) return;
      const length = distance(v[(i + v.length - 1) % v.length], v[i]);
      if (length < shortestLength) {
        shortest = i;
        shortestLength = length;
      }
    });
    if (shortest < 0) return v;
    edges.splice(shortest, 1);
  }
}

/** Clip a convex polygon to an axis-aligned rectangle (Sutherland–Hodgman). */
export function clipToRect(polygon: Point[], min: Point, max: Point): Point[] {
  const edges: [(p: Point) => number, (a: Point, b: Point) => Point][] = [
    [(p) => p.x - min.x, (a, b) => ({ x: min.x, y: a.y + ((b.y - a.y) * (min.x - a.x)) / (b.x - a.x) })],
    [(p) => max.x - p.x, (a, b) => ({ x: max.x, y: a.y + ((b.y - a.y) * (max.x - a.x)) / (b.x - a.x) })],
    [(p) => p.y - min.y, (a, b) => ({ x: a.x + ((b.x - a.x) * (min.y - a.y)) / (b.y - a.y), y: min.y })],
    [(p) => max.y - p.y, (a, b) => ({ x: a.x + ((b.x - a.x) * (max.y - a.y)) / (b.y - a.y), y: max.y })],
  ];
  let output = polygon;
  for (const [inside, cross] of edges) {
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const current = input[i];
      const previous = input[(i + input.length - 1) % input.length];
      if (inside(current) >= 0) {
        if (inside(previous) < 0) output.push(cross(previous, current));
        output.push(current);
      } else if (inside(previous) >= 0) {
        output.push(cross(previous, current));
      }
    }
  }
  return output;
}
