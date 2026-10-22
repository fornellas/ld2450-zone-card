import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeAssistant } from "./ha-types";
import { MIN_PAIR_WINDOW_MS, TargetTracker, pairWindowMs } from "./targets";

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
const target1 = sensors.slice(0, 1);
const points = (r: { positions: { point: unknown }[] }) => r.positions.map((p) => p.point);

/** A tracker with a record of how often it reported a change on its own. */
function tracker() {
  const onChange = vi.fn();
  return { tracker: new TargetTracker(onChange), onChange };
}

describe("pairWindowMs", () => {
  it("is 1.2 intervals, and never shorter than a radar frame", () => {
    expect(pairWindowMs(1)).toBe(1200);
    expect(pairWindowMs(2)).toBe(2400);
    expect(pairWindowMs(0.5)).toBe(600);
    expect(pairWindowMs(0.1)).toBe(120);
    expect(pairWindowMs(0.05)).toBe(MIN_PAIR_WINDOW_MS);
  });
});

describe("TargetTracker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe("reading targets", () => {
    it("reads tracked targets and skips idle slots", () => {
      const h = hass({
        "sensor.t1_x": "-782",
        "sensor.t1_y": "1713",
        "sensor.t2_x": "unknown",
        "sensor.t2_y": "unknown",
        "sensor.t3_x": "0",
        "sensor.t3_y": "0",
      });
      expect(tracker().tracker.read(h, sensors, 1).positions).toEqual([
        { label: "1", name: "Target 1", point: { x: -782, y: 1713 } },
      ]);
    });

    it.each([
      ["mm", "-782", "1713", { x: -782, y: 1713 }],
      ["cm", "-78.2", "171.3", { x: -782, y: 1713 }],
      ["m", "-0.782", "1.713", { x: -782, y: 1713 }],
      ["in", "-10", "20", { x: -254, y: 508 }],
      ["ft", "-1", "2", { x: -304.8, y: 609.6 }],
      ["yd", "1", "2", { x: 914.4, y: 1828.8 }],
    ])("converts sensors shown in %s to mm", (unit, x, y, point) => {
      const [position] = tracker().tracker.read(
        hass({ "sensor.t1_x": x, "sensor.t1_y": y }, unit),
        sensors,
        1,
      ).positions;
      expect(position.point.x).toBeCloseTo(point.x, 6);
      expect(position.point.y).toBeCloseTo(point.y, 6);
    });

    it.each([null, "°", "mm/s"])("skips sensors without a length unit (%s)", (unit) => {
      const h = hass({ "sensor.t1_x": "-782", "sensor.t1_y": "1713" }, unit);
      expect(tracker().tracker.read(h, sensors, 1).positions).toEqual([]);
    });

    it("skips unavailable and missing sensors", () => {
      const h = hass({ "sensor.t1_x": "unavailable", "sensor.t1_y": "100", "sensor.t3_x": "5", "sensor.t3_y": "600" });
      expect(tracker().tracker.read(h, sensors, 1).positions).toEqual([
        { label: "3", name: "Target 3", point: { x: 5, y: 600 } },
      ]);
    });
  });

  describe("pairing X and Y", () => {
    it("shows a target's first X and Y at once", () => {
      const { tracker: t } = tracker();
      const reading = t.read(hass({ "sensor.t1_x": "100", "sensor.t1_y": "1000" }), target1, 1);
      expect(points(reading)).toEqual([{ x: 100, y: 1000 }]);
      expect(reading.fresh.map((p) => p.point)).toEqual([{ x: 100, y: 1000 }]);
    });

    it("moves to a new X and Y that update together at once", () => {
      const { tracker: t } = tracker();
      t.read(hass({ "sensor.t1_x": "100", "sensor.t1_y": "1000" }), target1, 1);
      const reading = t.read(hass({ "sensor.t1_x": "200", "sensor.t1_y": "1100" }), target1, 1);
      expect(points(reading)).toEqual([{ x: 200, y: 1100 }]);
      expect(reading.fresh).toHaveLength(1);
    });

    it("waits for the other axis, and moves to the pair when it arrives", () => {
      const { tracker: t, onChange } = tracker();
      t.read(hass({ "sensor.t1_x": "100", "sensor.t1_y": "1000" }), target1, 1);
      // X updates alone: the target stays put
      let reading = t.read(hass({ "sensor.t1_x": "200", "sensor.t1_y": "1000" }), target1, 1);
      expect(points(reading)).toEqual([{ x: 100, y: 1000 }]);
      expect(reading.fresh).toEqual([]);
      // Y follows within the window: both are new, and the target moves at once
      vi.advanceTimersByTime(500);
      reading = t.read(hass({ "sensor.t1_x": "200", "sensor.t1_y": "1300" }), target1, 1);
      expect(points(reading)).toEqual([{ x: 200, y: 1300 }]);
      expect(reading.fresh.map((p) => p.point)).toEqual([{ x: 200, y: 1300 }]);
      // The wait is over, so nothing happens when it would have ended
      vi.advanceTimersByTime(5000);
      expect(onChange).not.toHaveBeenCalled();
      expect(t.read(hass({ "sensor.t1_x": "200", "sensor.t1_y": "1300" }), target1, 1).fresh).toEqual([]);
    });

    it("moves with the other axis' current value when it doesn't arrive", () => {
      const { tracker: t, onChange } = tracker();
      t.read(hass({ "sensor.t1_x": "100", "sensor.t1_y": "1000" }), target1, 1);
      t.read(hass({ "sensor.t1_x": "200", "sensor.t1_y": "1000" }), target1, 1);
      vi.advanceTimersByTime(1199);
      expect(onChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onChange).toHaveBeenCalledTimes(1);
      // The next read has the new position, and reports it as new once
      const reading = t.read(hass({ "sensor.t1_x": "200", "sensor.t1_y": "1000" }), target1, 1);
      expect(points(reading)).toEqual([{ x: 200, y: 1000 }]);
      expect(reading.fresh.map((p) => p.point)).toEqual([{ x: 200, y: 1000 }]);
      expect(t.read(hass({ "sensor.t1_x": "200", "sensor.t1_y": "1000" }), target1, 1).fresh).toEqual([]);
    });

    it("waits as long as the update interval says", () => {
      const { tracker: t, onChange } = tracker();
      t.read(hass({ "sensor.t1_x": "100", "sensor.t1_y": "1000" }), target1, 0.1);
      t.read(hass({ "sensor.t1_x": "200", "sensor.t1_y": "1000" }), target1, 0.1);
      vi.advanceTimersByTime(119);
      expect(onChange).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onChange).toHaveBeenCalledTimes(1);

      t.read(hass({ "sensor.t1_x": "200", "sensor.t1_y": "1100" }), target1, 3);
      vi.advanceTimersByTime(3599);
      expect(onChange).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(onChange).toHaveBeenCalledTimes(2);
    });

    it("uses the latest value when an axis updates again while waiting", () => {
      const { tracker: t } = tracker();
      t.read(hass({ "sensor.t1_x": "100", "sensor.t1_y": "1000" }), target1, 1);
      t.read(hass({ "sensor.t1_x": "200", "sensor.t1_y": "1000" }), target1, 1);
      vi.advanceTimersByTime(300);
      expect(points(t.read(hass({ "sensor.t1_x": "300", "sensor.t1_y": "1000" }), target1, 1))).toEqual([
        { x: 100, y: 1000 },
      ]);
      // The wait doesn't restart, and ends with the newest X
      vi.advanceTimersByTime(900);
      expect(points(t.read(hass({ "sensor.t1_x": "300", "sensor.t1_y": "1000" }), target1, 1))).toEqual([
        { x: 300, y: 1000 },
      ]);
    });

    it("pairs the other way round: Y first, then X", () => {
      const { tracker: t } = tracker();
      t.read(hass({ "sensor.t1_x": "100", "sensor.t1_y": "1000" }), target1, 1);
      t.read(hass({ "sensor.t1_x": "100", "sensor.t1_y": "1500" }), target1, 1);
      const reading = t.read(hass({ "sensor.t1_x": "150", "sensor.t1_y": "1500" }), target1, 1);
      expect(points(reading)).toEqual([{ x: 150, y: 1500 }]);
    });

    it("doesn't count a sensor that publishes the same value again", () => {
      const { tracker: t, onChange } = tracker();
      t.read(hass({ "sensor.t1_x": "100", "sensor.t1_y": "1000" }), target1, 1);
      const reading = t.read(hass({ "sensor.t1_x": "100", "sensor.t1_y": "1000" }), target1, 1);
      expect(reading.fresh).toEqual([]);
      vi.advanceTimersByTime(5000);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("keeps each target's wait apart", () => {
      const { tracker: t, onChange } = tracker();
      const both = (a: [string, string], b: [string, string]) =>
        hass({ "sensor.t1_x": a[0], "sensor.t1_y": a[1], "sensor.t2_x": b[0], "sensor.t2_y": b[1] });
      t.read(both(["100", "1000"], ["500", "2000"]), sensors.slice(0, 2), 1);
      // Target 1's X updates alone; target 2's Y updates alone
      t.read(both(["200", "1000"], ["500", "2100"]), sensors.slice(0, 2), 1);
      vi.advanceTimersByTime(600);
      // Target 1's Y arrives, which only completes target 1
      const reading = t.read(both(["200", "1100"], ["500", "2100"]), sensors.slice(0, 2), 1);
      expect(points(reading)).toEqual([
        { x: 200, y: 1100 },
        { x: 500, y: 2000 },
      ]);
      vi.advanceTimersByTime(600);
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });

  describe("empty slots", () => {
    it("clears a target going unknown at once, and cancels its wait", () => {
      const { tracker: t, onChange } = tracker();
      t.read(hass({ "sensor.t1_x": "100", "sensor.t1_y": "1000" }), target1, 1);
      t.read(hass({ "sensor.t1_x": "200", "sensor.t1_y": "1000" }), target1, 1);
      expect(t.read(hass({ "sensor.t1_x": "unknown", "sensor.t1_y": "unknown" }), target1, 1).positions).toEqual([]);
      vi.advanceTimersByTime(5000);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("clears a target at (0, 0)", () => {
      const { tracker: t } = tracker();
      t.read(hass({ "sensor.t1_x": "100", "sensor.t1_y": "1000" }), target1, 1);
      expect(t.read(hass({ "sensor.t1_x": "0", "sensor.t1_y": "0" }), target1, 1).positions).toEqual([]);
    });

    it("shows a new target in the same slot at once", () => {
      const { tracker: t } = tracker();
      t.read(hass({ "sensor.t1_x": "100", "sensor.t1_y": "1000" }), target1, 1);
      t.read(hass({ "sensor.t1_x": "unknown", "sensor.t1_y": "unknown" }), target1, 1);
      // Y arrives before X: nothing yet, and then both are there
      expect(t.read(hass({ "sensor.t1_x": "unknown", "sensor.t1_y": "2000" }), target1, 1).positions).toEqual([]);
      expect(points(t.read(hass({ "sensor.t1_x": "-300", "sensor.t1_y": "2000" }), target1, 1))).toEqual([
        { x: -300, y: 2000 },
      ]);
    });
  });

  it("stops waiting and forgets targets when disposed", () => {
    const { tracker: t, onChange } = tracker();
    t.read(hass({ "sensor.t1_x": "100", "sensor.t1_y": "1000" }), target1, 1);
    t.read(hass({ "sensor.t1_x": "200", "sensor.t1_y": "1000" }), target1, 1);
    t.dispose();
    vi.advanceTimersByTime(5000);
    expect(onChange).not.toHaveBeenCalled();
    // As if new: the first X and Y show at once
    expect(points(t.read(hass({ "sensor.t1_x": "300", "sensor.t1_y": "1100" }), target1, 1))).toEqual([
      { x: 300, y: 1100 },
    ]);
  });
});
