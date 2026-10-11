// Live target positions from the target X/Y sensors.

import type { TargetSensors } from "./discovery";
import type { HassEntity, HomeAssistant } from "./ha-types";
import type { Point } from "./polygon";
import { toMillimetres } from "./units";

/**
 * How close, in ms, the X and Y sensors' updates must be to come from the same radar frame. The LD2450 sends at most
 * one frame every 100 ms (10 Hz), and ESPHome sends the X and Y of a frame together, so updates further apart than
 * this may pair the X of one frame with the Y of another: a position where nobody was.
 */
export const SAME_FRAME_MS = 100;

export interface TargetPosition {
  /** Short label for the map: "1", "2", "3". */
  label: string;
  name: string;
  /** Radar coordinates, in mm. */
  point: Point;
}

/** A target sensor's value in mm, converted from the unit HA shows it in. Undefined without a length unit. */
function coordinate(stateObj: HassEntity | undefined): number | undefined {
  const state = stateObj?.state;
  if (stateObj === undefined || state === undefined || state.trim() === "") return undefined;
  const value = Number(state);
  if (!Number.isFinite(value)) return undefined;
  return toMillimetres(value, stateObj.attributes.unit_of_measurement);
}

/**
 * When the sensor last published, in ms: the newer of last_updated (a new value) and last_reported (the same value
 * published again). NaN when HA doesn't say.
 */
function publishedAt(stateObj: HassEntity): number {
  const updated = Date.parse(stateObj.last_updated);
  const reported = stateObj.last_reported === undefined ? NaN : Date.parse(stateObj.last_reported);
  if (Number.isNaN(reported)) return updated;
  if (Number.isNaN(updated)) return reported;
  return Math.max(updated, reported);
}

export interface TargetReading {
  /** Where targets are: the last position each was seen at with its X and Y in sync. */
  positions: TargetPosition[];
  /** Positions read in sync from the sensors' latest updates, not reported before: what the trail records. */
  fresh: TargetPosition[];
}

/**
 * Reads targets, pairing X and Y only when they come from the same radar frame. ESPHome publishes a value only when
 * it changes, so a target moving along one axis updates just that sensor: its last in-sync position keeps being
 * shown until X and Y update together again.
 */
export class TargetTracker {
  /** The last in-sync position of each target, by its X sensor, with when it was published. */
  private _synced = new Map<string, { point: Point; at: number }>();

  /** Slots that are "unknown", "unavailable" or at (0, 0) are not tracking anyone, and are cleared at once. */
  read(hass: HomeAssistant, targets: TargetSensors[]): TargetReading {
    const positions: TargetPosition[] = [];
    const fresh: TargetPosition[] = [];
    targets.forEach((target, index) => {
      const xState = hass.states[target.x];
      const yState = hass.states[target.y];
      const x = coordinate(xState);
      const y = coordinate(yState);
      if (x === undefined || y === undefined || (x === 0 && y === 0)) {
        this._synced.delete(target.x);
        return;
      }
      const label = String(index + 1);
      const xAt = publishedAt(xState!);
      const yAt = publishedAt(yState!);
      // Without update times there's no telling frames apart, so take the values as they are
      const inSync = Number.isNaN(xAt) || Number.isNaN(yAt) || Math.abs(xAt - yAt) <= SAME_FRAME_MS;
      const last = this._synced.get(target.x);
      if (inSync) {
        const at = Math.max(Number.isNaN(xAt) ? -Infinity : xAt, Number.isNaN(yAt) ? -Infinity : yAt);
        const isNew = last === undefined || last.point.x !== x || last.point.y !== y || at > last.at;
        this._synced.set(target.x, { point: { x, y }, at });
        const position = { label, name: target.name, point: { x, y } };
        positions.push(position);
        if (isNew) fresh.push(position);
      } else if (last !== undefined) {
        positions.push({ label, name: target.name, point: last.point });
      }
    });
    return { positions, fresh };
  }
}

/** Targets being tracked now, from the sensors' current values, without pairing frames. */
export function readTargets(hass: HomeAssistant, targets: TargetSensors[]): TargetPosition[] {
  return new TargetTracker().read(hass, targets).positions;
}
