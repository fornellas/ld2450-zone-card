import { describe, expect, it } from "vitest";
import { insertionIndex, snap } from "./geometry";
import { checkPolygon, formatPolygon } from "./polygon";
import { formatRoomText, parseRoomText } from "./polygon-text";

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
    expect(checkPolygon([])).toEqual({ errors: [], outside: [] });
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

  it("checks the rounded values, as sent", () => {
    expect(checkPolygon([...square.slice(0, 3), { x: 4860.4, y: -0.4 }]).outside).toEqual([]);
  });
});

describe("room text", () => {
  it("formats mm and inches", () => {
    expect(formatRoomText([{ x: -782.4, y: 1713 }], "metric")).toBe("-782,1713");
    expect(formatRoomText([{ x: 254, y: -0.01 }], "imperial")).toBe("10,0");
  });

  it("parses mm and inches", () => {
    expect(parseRoomText(" -782, 1713 ; 0,0;", "metric")).toEqual([
      { x: -782, y: 1713 },
      { x: 0, y: 0 },
    ]);
    expect(parseRoomText("10,-2.5", "imperial")).toEqual([{ x: 254, y: -63.5 }]);
    expect(parseRoomText("  ", "metric")).toEqual([]);
  });

  it.each(["1,2;3", "a,b", "1,2,3", "1,,2", "1,2;;3,4"])("explains what's wrong in %s", (text) => {
    expect(parseRoomText(text, "metric")).toMatch(/^Point \d+/);
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

  it("snaps to a step", () => {
    expect(snap({ x: 149, y: -151 }, 100)).toEqual({ x: 100, y: -200 });
    expect(snap({ x: 149, y: -151 }, 0)).toEqual({ x: 149, y: -151 });
  });
});
