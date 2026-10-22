// Live target positions, from the "xy" text sensors of the ld2450 targets (esphome/esphome#21416).

import type { TargetSensors } from "./discovery";
import type { HomeAssistant } from "./ha-types";
import type { Point } from "./polygon";

export interface TargetPosition {
  /** Short label for the map: "1", "2", "3". */
  label: string;
  name: string;
  /** Radar coordinates, in mm. */
  point: Point;
}

/** What an xy text sensor publishes for a tracked target: "x,y", whole mm, from one radar frame. */
const XY_STATE = /^(-?\d+),(-?\d+)$/;

/** The position in an xy text sensor's state, or undefined for "NA" (no target), unknown, unavailable or anything else. */
export function parseXY(state: string | undefined): Point | undefined {
  const m = state === undefined ? null : XY_STATE.exec(state);
  return m === null ? undefined : { x: Number(m[1]), y: Number(m[2]) };
}

/** Whether a state is something an xy text sensor publishes: a position, "NA", or HA's unknown and unavailable. */
export function isXYState(state: string): boolean {
  return XY_STATE.test(state) || ["NA", "unknown", "unavailable"].includes(state);
}

/** Targets being tracked now. An empty slot ("NA", unknown or unavailable) has no position. */
export function readTargets(hass: HomeAssistant, targets: TargetSensors[]): TargetPosition[] {
  return targets.flatMap((sensors, index) => {
    const point = parseXY(hass.states[sensors.xy]?.state);
    return point === undefined ? [] : [{ label: String(index + 1), name: sensors.name, point }];
  });
}
