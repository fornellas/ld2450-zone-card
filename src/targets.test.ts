import { describe, expect, it } from "vitest";
import type { HomeAssistant } from "./ha-types";
import { readTargets } from "./targets";

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
