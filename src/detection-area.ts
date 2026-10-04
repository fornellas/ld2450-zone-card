// Where the radar can see, in radar coordinates (mm).

import type { Point } from "./polygon";
import { POLYGON_MAX_X, POLYGON_MAX_Y, POLYGON_MIN_X, POLYGON_MIN_Y } from "./polygon";

// Tracking range from Fig. 7 of the HLK-LD2450 manual (wall mounted at 1.5 m), measured from the plot:
// [angle from straight ahead in degrees, range in mm]. Nothing is tracked beyond ±60°.
const MEASURED_RANGE: [number, number][] = [
  [0, 8000],
  [15, 7350],
  [30, 6300],
  [45, 5000],
  [60, 1500],
];

function polar(angle: number, range: number): Point {
  const a = (angle * Math.PI) / 180;
  // "+ 0" turns -0 into 0
  return { x: Math.round(range * Math.sin(a)) + 0, y: Math.round(range * Math.cos(a)) + 0 };
}

/** The tracking range as a closed polygon, starting and ending at the radar. */
export const DETECTION_AREA: Point[] = [
  { x: 0, y: 0 },
  ...[...MEASURED_RANGE].reverse().map(([angle, range]) => polar(-angle, range)),
  ...MEASURED_RANGE.slice(1).map(([angle, range]) => polar(angle, range)),
];

/** The coordinates the firmware accepts for polygon points. */
export const FIRMWARE_BOUNDS: Point[] = [
  { x: POLYGON_MIN_X, y: POLYGON_MIN_Y },
  { x: POLYGON_MAX_X, y: POLYGON_MIN_Y },
  { x: POLYGON_MAX_X, y: POLYGON_MAX_Y },
  { x: POLYGON_MIN_X, y: POLYGON_MAX_Y },
];
