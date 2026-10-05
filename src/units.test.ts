import { describe, expect, it } from "vitest";
import { defaultUnits, formatGridLabel, formatLength, gridSpacing } from "./units";

describe("units", () => {
  it("formats lengths", () => {
    expect(formatLength(1250, "metric")).toBe("1.25 m");
    expect(formatLength(1250, "imperial")).toBe("4′ 1″");
    expect(formatLength(-305, "imperial")).toBe("-1′ 0″");
  });

  it("labels the grid", () => {
    expect(formatGridLabel(2000, "metric")).toBe("2 m");
    expect(formatGridLabel(750, "metric")).toBe("0.75 m");
    expect(formatGridLabel(-0.1, "metric")).toBe("0 m");
    expect(formatGridLabel(3048, "imperial")).toBe("10 ft");
  });

  it("spaces grid lines and labels to stay readable", () => {
    // A 12 m map: 25 cm lines fit, labels every 1 m
    expect(gridSpacing(250, 12000, "metric")).toEqual({ minor: 250, major: 1000 });
    // 1 cm lines would be too dense, so every 20th is drawn
    expect(gridSpacing(10, 12000, "metric")).toEqual({ minor: 200, major: 1000 });
    expect(gridSpacing(2000, 12000, "metric")).toEqual({ minor: 2000, major: 2000 });
    // No round multiple of 30 cm fits, so labels go where they fit
    expect(gridSpacing(300, 12000, "metric")).toEqual({ minor: 300, major: 1200 });
    expect(gridSpacing(304.8, 12000, "imperial")).toEqual({ minor: 304.8, major: 1524 });
  });

  it("defaults to HA's unit system", () => {
    expect(defaultUnits("km")).toBe("metric");
    expect(defaultUnits("mi")).toBe("imperial");
    expect(defaultUnits(undefined)).toBe("metric");
  });
});
