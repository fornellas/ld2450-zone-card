import { describe, expect, it } from "vitest";
import type { HomeAssistant } from "./ha-types";
import { SAME_FRAME_MS, TargetTracker, readTargets } from "./targets";

/** States in mm unless a unit is given (null for none), as HA shows the firmware's sensors by default. */
function hass(states: Record<string, string>, unit: string | null = "mm"): HomeAssistant {
  return {
    states: Object.fromEntries(
      Object.entries(states).map(([entity_id, state]) => [
        entity_id,
        {
          entity_id,
          state,
          attributes: unit === null ? {} : { unit_of_measurement: unit },
          last_changed: "",
          last_updated: "",
        },
      ]),
    ),
    entities: {},
    devices: {},
    config: { unit_system: { length: "km" } },
    connection: { subscribeMessage: () => Promise.reject(new Error()) },
    callService: () => Promise.resolve(),
    callWS: () => Promise.reject(new Error()),
  };
}

const sensors = [1, 2, 3].map((n) => ({ x: `sensor.t${n}_x`, y: `sensor.t${n}_y`, name: `Target ${n}` }));

describe("readTargets", () => {
  it("reads tracked targets and skips idle slots", () => {
    const h = hass({
      "sensor.t1_x": "-782",
      "sensor.t1_y": "1713",
      "sensor.t2_x": "unknown",
      "sensor.t2_y": "unknown",
      "sensor.t3_x": "0",
      "sensor.t3_y": "0",
    });
    expect(readTargets(h, sensors)).toEqual([{ label: "1", name: "Target 1", point: { x: -782, y: 1713 } }]);
  });

  it.each([
    ["mm", "-782", "1713", { x: -782, y: 1713 }],
    ["cm", "-78.2", "171.3", { x: -782, y: 1713 }],
    ["m", "-0.782", "1.713", { x: -782, y: 1713 }],
    ["in", "-10", "20", { x: -254, y: 508 }],
    ["ft", "-1", "2", { x: -304.8, y: 609.6 }],
    ["yd", "1", "2", { x: 914.4, y: 1828.8 }],
  ])("converts sensors shown in %s to mm", (unit, x, y, point) => {
    const [target] = readTargets(hass({ "sensor.t1_x": x, "sensor.t1_y": y }, unit), sensors);
    expect(target.point.x).toBeCloseTo(point.x, 6);
    expect(target.point.y).toBeCloseTo(point.y, 6);
  });

  it.each([null, "°", "mm/s"])("skips sensors without a length unit (%s)", (unit) => {
    expect(readTargets(hass({ "sensor.t1_x": "-782", "sensor.t1_y": "1713" }, unit), sensors)).toEqual([]);
  });

  it("skips unavailable and missing sensors", () => {
    const h = hass({ "sensor.t1_x": "unavailable", "sensor.t1_y": "100", "sensor.t3_x": "5", "sensor.t3_y": "600" });
    expect(readTargets(h, sensors)).toEqual([{ label: "3", name: "Target 3", point: { x: 5, y: 600 } }]);
  });
});

describe("TargetTracker", () => {
  const T0 = Date.parse("2026-10-11T12:00:00Z");
  const at = (ms: number) => new Date(T0 + ms).toISOString();
  const target = [{ x: "sensor.t1_x", y: "sensor.t1_y", name: "Target 1" }];

  /** Target 1's X and Y, each with when it was updated (ms after T0), and optionally when it was last reported. */
  function frame(x: [string, number, number?], y: [string, number, number?]): HomeAssistant {
    const h = hass({ "sensor.t1_x": x[0], "sensor.t1_y": y[0] });
    for (const [id, [, updated, reported]] of [
      ["sensor.t1_x", x],
      ["sensor.t1_y", y],
    ] as const) {
      h.states[id].last_updated = at(updated);
      if (reported !== undefined) h.states[id].last_reported = at(reported);
    }
    return h;
  }

  it("takes X and Y updated within the same frame as a new position", () => {
    const reading = new TargetTracker().read(frame(["100", 0], ["1000", SAME_FRAME_MS]), target);
    expect(reading.positions.map((p) => p.point)).toEqual([{ x: 100, y: 1000 }]);
    expect(reading.fresh.map((p) => p.point)).toEqual([{ x: 100, y: 1000 }]);
  });

  it("doesn't pair X and Y from different frames", () => {
    const reading = new TargetTracker().read(frame(["100", 0], ["1000", SAME_FRAME_MS + 1]), target);
    expect(reading).toEqual({ positions: [], fresh: [] });
  });

  it("keeps showing the last in-sync position while one axis is stale", () => {
    const tracker = new TargetTracker();
    tracker.read(frame(["100", 0], ["1000", 0]), target);
    // Moving only along Y: ESPHome publishes Y, and X keeps its old update time
    const reading = tracker.read(frame(["100", 0], ["1500", 2000]), target);
    expect(reading.positions.map((p) => p.point)).toEqual([{ x: 100, y: 1000 }]);
    expect(reading.fresh).toEqual([]);
  });

  it("pairs a value published again, by its last_reported", () => {
    const tracker = new TargetTracker();
    tracker.read(frame(["100", 0], ["1000", 0]), target);
    // X unchanged but published again with the new Y, in the same frame
    const reading = tracker.read(frame(["100", 0, 2000], ["1500", 2000]), target);
    expect(reading.fresh.map((p) => p.point)).toEqual([{ x: 100, y: 1500 }]);
  });

  it("reports a position once", () => {
    const tracker = new TargetTracker();
    const h = frame(["100", 0], ["1000", 0]);
    tracker.read(h, target);
    expect(tracker.read(h, target).fresh).toEqual([]);
  });

  it("clears a target going unknown at once", () => {
    const tracker = new TargetTracker();
    tracker.read(frame(["100", 0], ["1000", 0]), target);
    expect(tracker.read(frame(["unknown", 500], ["1000", 0]), target).positions).toEqual([]);
    // And doesn't bring the old position back when X and Y are out of sync afterwards
    expect(tracker.read(frame(["100", 900], ["1000", 0]), target).positions).toEqual([]);
  });
});
