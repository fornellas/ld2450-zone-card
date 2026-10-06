import { describe, expect, it } from "vitest";
import { clipToRect, distance, distanceToSegment, insertionIndex, insidePolygon, perimeter, snap } from "./geometry";
import { checkPolygon, formatPolygon } from "./polygon";

const square = [
  { x: 0, y: 0 },
  { x: 1000, y: 0 },
  { x: 1000, y: 1000 },
  { x: 0, y: 1000 },
];

describe("formatPolygon", () => {
  it("rounds to whole mm", () => {
    expect(
      formatPolygon([
        { x: -0.4, y: 1.6 },
        { x: 1000.5, y: 0 },
      ]),
    ).toBe("0,2;1001,0");
  });
});

describe("checkPolygon", () => {
  it("accepts an empty polygon, which disables the zone", () => {
    expect(checkPolygon([])).toEqual({ errors: [], warnings: [], outside: [] });
  });

  it("needs at least 3 points", () => {
    expect(checkPolygon(square.slice(0, 2)).errors).toEqual(["A zone needs at least 3 points."]);
  });

  it("allows at most 23 points", () => {
    const points = Array.from({ length: 24 }, (_, i) => ({ x: i, y: 100 }));
    expect(checkPolygon(points).errors).toEqual(["A zone can have at most 23 points."]);
  });

  it("finds points outside the limits", () => {
    const check = checkPolygon([...square, { x: 5000, y: 100 }, { x: 0, y: -1 }]);
    expect(check.outside).toEqual([4, 5]);
    expect(check.errors).toEqual(["Points 5, 6 are outside the zone point limits."]);
  });

  it("warns about points outside the tracking range", () => {
    const check = checkPolygon(square, (p) => p.x < 1000);
    expect(check.errors).toEqual([]);
    expect(check.warnings).toEqual(["Points 2, 3 are outside the tracking range, where the radar can't see anyone."]);
    expect(check.outside).toEqual([1, 2]);
  });

  it("checks the rounded values, as sent", () => {
    expect(checkPolygon([...square.slice(0, 3), { x: 4860.4, y: -0.4 }]).outside).toEqual([]);
  });
});

describe("geometry", () => {
  it("inserts on the closest edge", () => {
    expect(insertionIndex(square, { x: 500, y: 10 }, 50)).toBe(1);
    expect(insertionIndex(square, { x: 10, y: 500 }, 50)).toBe(4);
  });

  it("appends when no edge is close", () => {
    expect(insertionIndex(square, { x: 500, y: 500 }, 50)).toBe(4);
    expect(insertionIndex(square.slice(0, 2), { x: 500, y: 500 }, 50)).toBe(2);
  });

  it("tells points inside a polygon, including its edges", () => {
    expect(insidePolygon({ x: 500, y: 500 }, square)).toBe(true);
    expect(insidePolygon({ x: 1000, y: 500 }, square)).toBe(true);
    expect(insidePolygon({ x: 1001.5, y: 500 }, square)).toBe(false);
    expect(insidePolygon({ x: -1, y: -1 }, square)).toBe(false);
  });

  it("snaps to a step", () => {
    expect(snap({ x: 149, y: -151 }, 100)).toEqual({ x: 100, y: -200 });
    expect(snap({ x: 149, y: -151 }, 0)).toEqual({ x: 149, y: -151 });
  });
});

describe("perimeter", () => {
  const trail = [
    { x: 0, y: 1000 },
    { x: 1000, y: 1000 },
    { x: 500, y: 2000 },
    { x: 400, y: 1300 },
  ];

  it("keeps every point at least the margin inside, with at most 16 points", () => {
    const polygon = perimeter(trail, 300);
    expect(polygon.length).toBeLessThanOrEqual(16);
    for (const p of trail) {
      expect(insidePolygon(p, polygon)).toBe(true);
      for (let i = 0; i < polygon.length; i++) {
        expect(distanceToSegment(p, polygon[i], polygon[(i + 1) % polygon.length])).toBeGreaterThanOrEqual(299.9);
      }
    }
  });

  it("surrounds a single point", () => {
    const polygon = perimeter([{ x: 0, y: 1000 }], 200);
    // Its 16 edges would be about 80 mm, so some are left out
    expect(polygon.length).toBeLessThan(16);
    expect(polygon.length).toBeGreaterThanOrEqual(4);
    expect(insidePolygon({ x: 0, y: 1000 }, polygon)).toBe(true);
  });

  it("leaves out very short edges", () => {
    const polygon = perimeter(trail, 300);
    for (let i = 0; i < polygon.length; i++) {
      expect(distance(polygon[i], polygon[(i + 1) % polygon.length])).toBeGreaterThanOrEqual(300);
    }
  });

  it("is empty without points", () => {
    expect(perimeter([], 200)).toEqual([]);
  });
});

describe("clipToRect", () => {
  it("cuts a polygon to the rectangle", () => {
    const square = [
      { x: -100, y: -100 },
      { x: 100, y: -100 },
      { x: 100, y: 100 },
      { x: -100, y: 100 },
    ];
    expect(clipToRect(square, { x: 0, y: 0 }, { x: 1000, y: 1000 })).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
  });
});
