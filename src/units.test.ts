import { describe, expect, it } from "vitest";
import { defaultUnits, formatGridLabel, formatLength, gridSpacing } from "./units";

describe("units", () => {
  it("formats lengths", () => {
    expect(formatLength(1250, "metric")).toBe("1.25 m");
    expect(formatLength(1250, "imperial")).toBe("4′ 1″");
    expect(formatLength(-305, "imperial")).toBe("-1′ 0″");
  });

  it("labels the grid on major lines", () => {
    const metric = gridSpacing("metric");
    expect(formatGridLabel(2 * metric.major, "metric")).toBe("2 m");
    const imperial = gridSpacing("imperial");
    expect(formatGridLabel(2 * imperial.major, "imperial")).toBe("10 ft");
  });

  it("defaults to HA's unit system", () => {
    expect(defaultUnits("km")).toBe("metric");
    expect(defaultUnits("mi")).toBe("imperial");
    expect(defaultUnits(undefined)).toBe("metric");
  });
});
