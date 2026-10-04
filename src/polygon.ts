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
