import { describe, expect, it } from "vitest";
import { DETECTION_AREA } from "./detection-area";

describe("DETECTION_AREA", () => {
  it("starts at the radar and is symmetric", () => {
    expect(DETECTION_AREA[0]).toEqual({ x: 0, y: 0 });
    const outline = DETECTION_AREA.slice(1);
    expect(outline).toHaveLength(9);
    expect(outline[4]).toEqual({ x: 0, y: 8000 });
    for (let i = 0; i < 4; i++) {
      expect(outline[i].x).toBe(-outline[8 - i].x);
      expect(outline[i].y).toBe(outline[8 - i].y);
    }
  });

  it("goes from the left edge to the right edge", () => {
    expect(DETECTION_AREA[1].x).toBeLessThan(0);
    expect(DETECTION_AREA[DETECTION_AREA.length - 1].x).toBeGreaterThan(0);
  });
});
