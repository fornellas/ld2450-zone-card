import { describe, expect, it } from "vitest";
import type { HomeAssistant } from "./ha-types";
import { isXYState, parseXY, readTargets } from "./targets";

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
    connection: { subscribeMessage: () => Promise.reject(new Error()) },
    callService: () => Promise.resolve(),
    callWS: () => Promise.reject(new Error()),
  };
}

const sensors = [1, 2, 3].map((n) => ({ xy: `sensor.t${n}_xy`, name: `Target ${n}` }));

describe("parseXY", () => {
  it.each([
    ["-782,1713", { x: -782, y: 1713 }],
    ["0,2000", { x: 0, y: 2000 }],
    ["4860,-7560", { x: 4860, y: -7560 }],
  ])("reads %s", (state, point) => {
    expect(parseXY(state)).toEqual(point);
  });

  it.each(["NA", "unknown", "unavailable", "", "1,2,3", "1;2", "1.5,2", " 1,2", "a,b", "1,", ",2"])(
    "has no position in %j",
    (state) => {
      expect(parseXY(state)).toBeUndefined();
    },
  );

  it("has no position without a state", () => {
    expect(parseXY(undefined)).toBeUndefined();
  });
});

describe("isXYState", () => {
  it.each(["-782,1713", "NA", "unknown", "unavailable"])("accepts %s", (state) => {
    expect(isXYState(state)).toBe(true);
  });

  it.each(["Moving away", "Stationary", "", "1,2,3", "na", "on"])("rejects %j", (state) => {
    expect(isXYState(state)).toBe(false);
  });
});

describe("readTargets", () => {
  it("reads tracked targets, labelled by their order, and skips empty slots", () => {
    const h = hass({ "sensor.t1_xy": "-782,1713", "sensor.t2_xy": "NA", "sensor.t3_xy": "5,600" });
    expect(readTargets(h, sensors)).toEqual([
      { label: "1", name: "Target 1", point: { x: -782, y: 1713 } },
      { label: "3", name: "Target 3", point: { x: 5, y: 600 } },
    ]);
  });

  it("skips unknown, unavailable and missing sensors", () => {
    const h = hass({ "sensor.t1_xy": "unavailable", "sensor.t2_xy": "unknown" });
    expect(readTargets(h, sensors)).toEqual([]);
  });

  it("moves a target as soon as its sensor changes", () => {
    const positions = (state: string) => readTargets(hass({ "sensor.t1_xy": state }), sensors).map((t) => t.point);
    expect(positions("100,1000")).toEqual([{ x: 100, y: 1000 }]);
    expect(positions("300,1400")).toEqual([{ x: 300, y: 1400 }]);
    expect(positions("NA")).toEqual([]);
  });
});
