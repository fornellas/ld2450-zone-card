import { describe, expect, it } from "vitest";
import type { HomeAssistant } from "./ha-types";
import { readTargets } from "./targets";

function hass(states: Record<string, string>): HomeAssistant {
  return {
    states: Object.fromEntries(
      Object.entries(states).map(([entity_id, state]) => [
        entity_id,
        { entity_id, state, attributes: {}, last_changed: "", last_updated: "" },
      ]),
    ),
    entities: {},
    devices: {},
    config: { unit_system: { length: "km" } },
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

  it("skips unavailable and missing sensors", () => {
    const h = hass({ "sensor.t1_x": "unavailable", "sensor.t1_y": "100", "sensor.t3_x": "5", "sensor.t3_y": "600" });
    expect(readTargets(h, sensors)).toEqual([{ label: "3", name: "Target 3", point: { x: 5, y: 600 } }]);
  });
});
