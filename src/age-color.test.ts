import { describe, expect, it } from "vitest";
import { ageColor, ageFraction, ageGradient, formatMoment, timeRange } from "./age-color";

const channels = (color: string) => color.match(/\d+/g)!.map(Number);

describe("ageColor", () => {
  it("goes from a dark color for the oldest to a bright one for the newest", () => {
    const [or, og, ob] = channels(ageColor(0));
    const [nr, ng, nb] = channels(ageColor(1));
    expect(or + og + ob).toBeLessThan(nr + ng + nb);
    // Dark purple to yellow: the newest has far more green
    expect(ng).toBeGreaterThan(og + 100);
  });

  it("changes along the scale, and stays in range", () => {
    const colors = [0, 0.25, 0.5, 0.75, 1].map(ageColor);
    expect(new Set(colors).size).toBe(5);
    expect(ageColor(-5)).toBe(ageColor(0));
    expect(ageColor(5)).toBe(ageColor(1));
  });

  it("makes a gradient of the whole scale", () => {
    const gradient = ageGradient();
    expect(gradient.startsWith("linear-gradient(to right, ")).toBe(true);
    expect(gradient).toContain(ageColor(0));
    expect(gradient).toContain(ageColor(1));
  });
});

describe("timeRange and ageFraction", () => {
  const points = [
    { x: 0, y: 0, time: 3000 },
    { x: 0, y: 0, time: 1000 },
    { x: 0, y: 0, time: 2000 },
  ];

  it("finds the oldest and newest times", () => {
    expect(timeRange(points)).toEqual({ from: 1000, to: 3000 });
    expect(timeRange([])).toBeUndefined();
  });

  it("places a time on the range, with a single moment as the newest", () => {
    expect(ageFraction(1000, { from: 1000, to: 3000 })).toBe(0);
    expect(ageFraction(2000, { from: 1000, to: 3000 })).toBe(0.5);
    expect(ageFraction(3000, { from: 1000, to: 3000 })).toBe(1);
    expect(ageFraction(5, { from: 5, to: 5 })).toBe(1);
  });
});

describe("formatMoment", () => {
  it("labels with the date only when the range spans more than a day", () => {
    const morning = new Date(2026, 10, 7, 9, 5, 7).getTime();
    const evening = new Date(2026, 10, 7, 21, 30).getTime();
    const nextDay = new Date(2026, 10, 8, 9, 5).getTime();
    const sameDay = formatMoment(morning, { from: morning, to: evening });
    const acrossDays = formatMoment(morning, { from: morning, to: nextDay });
    expect(sameDay).not.toContain("2026");
    expect(acrossDays.length).toBeGreaterThan(sameDay.length);
  });
});
