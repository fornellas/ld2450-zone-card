import { describe, expect, it } from "vitest";
import type { HomeAssistant } from "./ha-types";
import { fetchTargetHistory, historyPoints, toLocalInput } from "./history";

describe("historyPoints", () => {
  it("mixes the targets by time, and skips repeats and empty slots", () => {
    const { points, truncated } = historyPoints(
      {
        "sensor.t1_xy": [
          { s: "NA", lu: 1 },
          { s: "100,1000", lu: 2 },
          { s: "100,1000", lu: 3 },
          { s: "200,1100", lu: 6 },
          { s: "NA", lu: 7 },
        ],
        "sensor.t2_xy": [
          { s: "unavailable", lu: 1 },
          { s: "-500,2000", lu: 4 },
        ],
      },
      100,
    );
    expect(truncated).toBe(false);
    expect(points).toEqual([
      { x: 100, y: 1000, time: 2000 },
      { x: -500, y: 2000, time: 4000 },
      { x: 200, y: 1100, time: 6000 },
    ]);
  });

  it("keeps the most recent ones, and says there were more", () => {
    const states = [1, 2, 3, 4].map((n) => ({ s: `${n},${n}`, lu: n }));
    expect(historyPoints({ a: states }, 2)).toEqual({
      points: [
        { x: 3, y: 3, time: 3000 },
        { x: 4, y: 4, time: 4000 },
      ],
      truncated: true,
    });
    expect(historyPoints({ a: states }, 4).truncated).toBe(false);
  });
});

describe("fetchTargetHistory", () => {
  it("asks for every recorded state of the sensors", async () => {
    let request: Record<string, unknown> | undefined;
    const hass = {
      callWS: (msg: Record<string, unknown>) => {
        request = msg;
        return Promise.resolve({ "sensor.t1_xy": [{ s: "1,2", lu: 1 }] });
      },
    } as unknown as HomeAssistant;
    const points = await fetchTargetHistory(
      hass,
      ["sensor.t1_xy"],
      new Date("2026-11-07T10:00:00Z"),
      new Date("2026-11-07T11:00:00Z"),
      10,
    );
    expect(points).toEqual({ points: [{ x: 1, y: 2, time: 1000 }], truncated: false });
    expect(request).toMatchObject({
      type: "history/history_during_period",
      start_time: "2026-11-07T10:00:00.000Z",
      end_time: "2026-11-07T11:00:00.000Z",
      entity_ids: ["sensor.t1_xy"],
      significant_changes_only: false,
      minimal_response: true,
      no_attributes: true,
    });
  });

  it("doesn't ask without sensors", async () => {
    const hass = { callWS: () => Promise.reject(new Error("asked")) } as unknown as HomeAssistant;
    expect(await fetchTargetHistory(hass, [], new Date(), new Date(), 10)).toEqual({ points: [], truncated: false });
  });
});

describe("toLocalInput", () => {
  it("formats local time for a datetime-local input", () => {
    expect(toLocalInput(new Date(2026, 10, 7, 9, 5))).toBe("2026-11-07T09:05");
  });
});
