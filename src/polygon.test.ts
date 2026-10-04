import { describe, expect, it } from "vitest";
import { POLYGON_PATTERN, isPolygonPattern, parsePolygon } from "./polygon";

describe("isPolygonPattern", () => {
  it("accepts the firmware pattern", () => {
    expect(isPolygonPattern(POLYGON_PATTERN)).toBe(true);
  });

  it("accepts a pattern with a different point limit", () => {
    expect(isPolygonPattern(POLYGON_PATTERN.replace("{2,22}", "{2,30}"))).toBe(true);
  });

  it.each([undefined, 3, "", ".*", "^[0-9,;-]*$", "(", "^ *-?\\d+ *, *\\d+ *(; *-?\\d+ *, *\\d+ *)*$"])(
    "rejects %s",
    (pattern) => {
      expect(isPolygonPattern(pattern)).toBe(false);
    },
  );
});

describe("parsePolygon", () => {
  it("parses canonical polygons", () => {
    expect(parsePolygon("-1000,800;0,800;0,1500")).toEqual([
      { x: -1000, y: 800 },
      { x: 0, y: 800 },
      { x: 0, y: 1500 },
    ]);
  });

  it("parses an empty polygon", () => {
    expect(parsePolygon("")).toEqual([]);
  });

  it("allows spaces and a trailing separator", () => {
    expect(parsePolygon(" 1 , 2 ; 3,4;")).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  it.each(["unavailable", "unknown", "1,2;3", "1.5,2", "1,2,3"])("rejects %s", (state) => {
    expect(parsePolygon(state)).toBeUndefined();
  });
});
