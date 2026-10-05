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

  it("spaces the grid", () => {
    expect(gridSpacing("metric")).toEqual({ minor: 500, major: 1000 });
    expect(gridSpacing("imperial")).toEqual({ minor: 304.8, major: 1524 });
  });

  it("defaults to HA's unit system", () => {
    expect(defaultUnits("km")).toBe("metric");
    expect(defaultUnits("mi")).toBe("imperial");
    expect(defaultUnits(undefined)).toBe("metric");
  });
});
