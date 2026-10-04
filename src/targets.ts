// Live target positions from the target X/Y sensors.

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

function coordinate(hass: HomeAssistant, entityId: string): number | undefined {
  const state = hass.states[entityId]?.state;
  if (state === undefined || state.trim() === "") return undefined;
  const value = Number(state);
  return Number.isFinite(value) ? value : undefined;
}

/** Targets being tracked now. Slots that are "unknown", "unavailable" or at (0, 0) are not tracking anyone. */
export function readTargets(hass: HomeAssistant, targets: TargetSensors[]): TargetPosition[] {
  const positions: TargetPosition[] = [];
  targets.forEach((target, index) => {
    const x = coordinate(hass, target.x);
    const y = coordinate(hass, target.y);
    if (x === undefined || y === undefined || (x === 0 && y === 0)) return;
    positions.push({ label: String(index + 1), name: target.name, point: { x, y } });
  });
  return positions;
}
