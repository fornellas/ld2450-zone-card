// Live target positions from the target X/Y sensors.

import type { TargetSensors } from "./discovery";
import type { HassEntity, HomeAssistant } from "./ha-types";
import type { Point } from "./polygon";
import { toMillimetres } from "./units";

/**
 * The radar sends at most one frame every 100 ms (10 Hz), so no sensor updates faster than this, and the X and Y of
 * a frame arrive within this of each other.
 */
export const MIN_PAIR_WINDOW_MS = 100;

/**
 * How long to wait for the other axis, as a multiple of the sensors' update interval. X and Y are separate sensors,
 * each with its own throttle clock, so they update at different moments: the other axis' next update is within the
 * interval, and typically within half of it. The margin covers updates that are delayed.
 */
const PAIR_WINDOW_FACTOR = 1.2;

/** How long to wait for the other axis after one updates, for sensors that update every intervalSeconds. */
export function pairWindowMs(intervalSeconds: number): number {
  return Math.max(MIN_PAIR_WINDOW_MS, Math.round(PAIR_WINDOW_FACTOR * intervalSeconds * 1000));
}

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

type Axis = "x" | "y";

interface TrackedTarget {
  label: string;
  name: string;
  /** The latest value of each axis, in mm. */
  x?: number;
  y?: number;
  /** The position being shown. */
  shown?: Point;
  /** Waiting for the other axis, after the one named here updated. */
  waiting?: { axis: Axis; timer: ReturnType<typeof setTimeout> };
}

export interface TargetReading {
  /** Where targets are now. */
  positions: TargetPosition[];
  /** Positions that became current since the last read, including ones that did while waiting. */
  fresh: TargetPosition[];
}

/**
 * Turns the target X/Y sensors into positions. X and Y are separate Home Assistant entities, throttled
 * independently by ESPHome, and only published when they change, so they hardly ever update at the same moment.
 * Taking the latest X with the latest Y would draw a mix of two moments, and requiring them to update together
 * would hardly ever show anything. Instead, when an axis updates, the tracker waits a short time for the other:
 * if it updates, the target moves to the new pair at once; if not, it moves with the other axis' current value.
 *
 * A target going unknown, unavailable or to (0, 0) is an empty slot, and is cleared at once.
 */
export class TargetTracker {
  private _targets = new Map<string, TrackedTarget>();
  private _emitted: TargetPosition[] = [];

  /** @param onChange Called when a target moves without a read: its wait for the other axis ended. */
  constructor(private readonly _onChange: () => void) {}

  /** @param intervalSeconds How often the target sensors update in Home Assistant: the ESPHome throttle. */
  read(hass: HomeAssistant, targets: TargetSensors[], intervalSeconds: number): TargetReading {
    targets.forEach((sensors, index) => {
      const target = this._target(sensors, index);
      const x = coordinate(hass.states[sensors.x]);
      const y = coordinate(hass.states[sensors.y]);
      if (x === undefined || y === undefined || (x === 0 && y === 0)) {
        this._clear(target);
        return;
      }
      const xChanged = x !== target.x;
      const yChanged = y !== target.y;
      target.x = x;
      target.y = y;
      if (!xChanged && !yChanged) return;
      if (xChanged && yChanged) {
        // Both at once, as on a target's first frame, or when they happen to line up
        this._move(target);
      } else if (target.waiting !== undefined) {
        // The other axis arrived (or the same one again, which only updates the value that'll be used)
        if (target.waiting.axis !== (xChanged ? "x" : "y")) this._move(target);
      } else {
        const axis = xChanged ? "x" : "y";
        const timer = setTimeout(() => {
          target.waiting = undefined;
          this._move(target);
          this._onChange();
        }, pairWindowMs(intervalSeconds));
        target.waiting = { axis, timer };
      }
    });
    const positions = targets.flatMap((sensors) => {
      const target = this._targets.get(sensors.x);
      return target?.shown === undefined
        ? []
        : [{ label: target.label, name: target.name, point: { ...target.shown } }];
    });
    const fresh = this._emitted;
    this._emitted = [];
    return { positions, fresh };
  }

  /** Stop waiting, and forget every target. */
  dispose(): void {
    for (const target of this._targets.values()) this._stopWaiting(target);
    this._targets.clear();
    this._emitted = [];
  }

  private _target(sensors: TargetSensors, index: number): TrackedTarget {
    let target = this._targets.get(sensors.x);
    if (target === undefined) {
      target = { label: "", name: "" };
      this._targets.set(sensors.x, target);
    }
    target.label = String(index + 1);
    target.name = sensors.name;
    return target;
  }

  private _stopWaiting(target: TrackedTarget): void {
    if (target.waiting !== undefined) clearTimeout(target.waiting.timer);
    target.waiting = undefined;
  }

  private _clear(target: TrackedTarget): void {
    this._stopWaiting(target);
    target.x = target.y = target.shown = undefined;
  }

  /** Show the target at its current X and Y. */
  private _move(target: TrackedTarget): void {
    this._stopWaiting(target);
    if (target.x === undefined || target.y === undefined) return;
    target.shown = { x: target.x, y: target.y };
    this._emitted.push({ label: target.label, name: target.name, point: { ...target.shown } });
  }
}
