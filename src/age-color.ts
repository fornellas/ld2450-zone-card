// A color scale for how long ago a target was seen: dark purple for the oldest position, through magenta and orange, to
// yellow for the newest, like the "inferno" scale of thermal cameras, where cold is dark and hot is bright.

import type { Point } from "./polygon";

/** A position of a target, and when it was seen, in ms since the epoch. */
export interface TrackPoint extends Point {
  time: number;
}

type RGB = [number, number, number];

// The inferno color map, at tenths of its length
const INFERNO: RGB[] = [
  [0, 0, 4],
  [22, 11, 57],
  [66, 10, 104],
  [106, 23, 110],
  [147, 38, 103],
  [188, 55, 84],
  [221, 81, 58],
  [243, 120, 25],
  [252, 165, 10],
  [246, 215, 70],
  [252, 255, 164],
];

// Its ends are left out: black is lost on a dark card, and white on a light one
const FROM = 0.2;
const TO = 0.88;

function inferno(position: number): RGB {
  const scaled = Math.min(Math.max(position, 0), 1) * (INFERNO.length - 1);
  const index = Math.min(Math.floor(scaled), INFERNO.length - 2);
  const share = scaled - index;
  const [a, b] = [INFERNO[index], INFERNO[index + 1]];
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * share)) as RGB;
}

/** The color for a position of the scale: 0 is the oldest, and 1 the newest. */
export function ageColor(age: number): string {
  const [r, g, b] = inferno(FROM + Math.min(Math.max(age, 0), 1) * (TO - FROM));
  return `rgb(${r}, ${g}, ${b})`;
}

/** The whole scale, as a CSS gradient from the oldest, on the left, to the newest. */
export function ageGradient(): string {
  const steps = Array.from({ length: 9 }, (_, i) => ageColor(i / 8));
  return `linear-gradient(to right, ${steps.join(", ")})`;
}

/** The oldest and newest times of the points, or undefined without points. */
export function timeRange(points: TrackPoint[]): { from: number; to: number } | undefined {
  if (points.length === 0) return undefined;
  // A loop rather than Math.min(...), which can't take thousands of points as arguments
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.time < from) from = p.time;
    if (p.time > to) to = p.time;
  }
  return { from, to };
}

/** Where a time is on the scale of a range: 0 at its start, 1 at its end. A single moment is the newest. */
export function ageFraction(time: number, range: { from: number; to: number }): number {
  return range.to === range.from ? 1 : (time - range.from) / (range.to - range.from);
}

/** A time to label the scale with: just the time of the day, unless the range spans more than that. */
export function formatMoment(time: number, range: { from: number; to: number }): string {
  const date = new Date(time);
  const sameDay = new Date(range.from).toDateString() === new Date(range.to).toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { timeStyle: "medium" })
    : date.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}
