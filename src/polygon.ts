// Polygon zone text format, mirroring the firmware (esphome/components/ld2450/polygon.h).

export const POLYGON_PATTERN = "^ *$|^ *-?\\d{1,4} *, *\\d{1,4} *(; *-?\\d{1,4} *, *\\d{1,4} *){2,22};? *$";
export const POLYGON_MIN = 0;
export const POLYGON_MAX = 255;
export const POLYGON_MIN_POINTS = 3;
export const POLYGON_MAX_POINTS = 23;
export const POLYGON_MIN_X = -4860;
export const POLYGON_MAX_X = 4860;
export const POLYGON_MIN_Y = 0;
export const POLYGON_MAX_Y = 7560;

export interface Point {
  x: number;
  y: number;
}

function compilePattern(pattern: string): RegExp | undefined {
  // Browsers apply the HTML pattern attribute with the "v" flag; fall back for browsers without it
  for (const flags of ["v", "u"]) {
    try {
      return new RegExp(`^(?:${pattern})$`, flags);
    } catch {
      // Try the next flag
    }
  }
  return undefined;
}

const patternCache = new Map<string, boolean>();

/** Whether a text entity's pattern accepts polygons, so it still matches if a future firmware tweaks the pattern. */
export function isPolygonPattern(pattern: unknown): boolean {
  if (typeof pattern !== "string") return false;
  if (pattern === POLYGON_PATTERN) return true;
  let result = patternCache.get(pattern);
  if (result === undefined) {
    const re = compilePattern(pattern);
    result =
      re !== undefined &&
      re.test("") &&
      re.test("0,0;0,100;100,100") &&
      re.test("-4860,0;4860,0;4860,7560") &&
      !re.test("junk") &&
      !re.test("0,0;0,100") &&
      !re.test("1,2;3,4;5,6x");
    patternCache.set(pattern, result);
  }
  return result;
}

/** Parse a polygon zone state. Returns undefined when it isn't a polygon (e.g. "unavailable"). */
export function parsePolygon(state: string): Point[] | undefined {
  const text = state.trim();
  if (text === "") return [];
  const points: Point[] = [];
  for (const part of text.replace(/;\s*$/, "").split(";")) {
    const coords = part.split(",");
    if (coords.length !== 2) return undefined;
    const [x, y] = coords.map((c) => c.trim());
    if (!/^-?\d+$/.test(x) || !/^-?\d+$/.test(y)) return undefined;
    points.push({ x: Number(x), y: Number(y) });
  }
  return points;
}

/** Most points a floor plan can have. It's only stored by HA, so this just keeps it reasonable. */
export const FLOOR_PLAN_MAX_POINTS = 100;

/** Check a floor plan. An empty one removes it. */
export function checkFloorPlan(points: Point[]): PolygonCheck {
  const errors: string[] = [];
  if (points.length > 0 && points.length < POLYGON_MIN_POINTS) {
    errors.push(`A floor plan needs at least ${POLYGON_MIN_POINTS} points.`);
  }
  if (points.length > FLOOR_PLAN_MAX_POINTS) {
    errors.push(`A floor plan can have at most ${FLOOR_PLAN_MAX_POINTS} points.`);
  }
  return { errors, warnings: [], outside: [] };
}

/** The canonical text the device stores and publishes: whole mm, no spaces. */
export function formatPolygon(points: Point[]): string {
  return points.map((p) => `${Math.round(p.x) + 0},${Math.round(p.y) + 0}`).join(";");
}

export interface PolygonCheck {
  /** Why the device would reject the polygon; empty if it would accept it. */
  errors: string[];
  /** Problems the device accepts, but are likely mistakes. */
  warnings: string[];
  /** Indexes of points with a problem: outside the limits or the tracking range. */
  outside: number[];
}

function pointList(indexes: number[]): string {
  return `Point${indexes.length > 1 ? "s" : ""} ${indexes.map((i) => i + 1).join(", ")} ${indexes.length > 1 ? "are" : "is"}`;
}

/**
 * Check a polygon in radar coordinates against what the firmware accepts, and optionally against where the radar
 * can track. An empty polygon disables the zone.
 */
export function checkPolygon(points: Point[], trackingRange?: (p: Point) => boolean): PolygonCheck {
  const errors: string[] = [];
  if (points.length > 0 && points.length < POLYGON_MIN_POINTS) {
    errors.push(`A zone needs at least ${POLYGON_MIN_POINTS} points.`);
  }
  if (points.length > POLYGON_MAX_POINTS) {
    errors.push(`A zone can have at most ${POLYGON_MAX_POINTS} points.`);
  }
  const outsideLimits: number[] = [];
  const outsideRange: number[] = [];
  points.forEach((p, i) => {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (x < POLYGON_MIN_X || x > POLYGON_MAX_X || y < POLYGON_MIN_Y || y > POLYGON_MAX_Y) {
      outsideLimits.push(i);
    } else if (trackingRange !== undefined && !trackingRange({ x, y })) {
      outsideRange.push(i);
    }
  });
  if (outsideLimits.length > 0) errors.push(`${pointList(outsideLimits)} outside the zone point limits.`);
  const warnings =
    outsideRange.length > 0
      ? [`${pointList(outsideRange)} outside the tracking range, where the radar can't see anyone.`]
      : [];
  return { errors, warnings, outside: [...outsideLimits, ...outsideRange].sort((a, b) => a - b) };
}
