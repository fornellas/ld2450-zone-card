// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import "./zone-map";
import type { Ld2450ZoneMap } from "./zone-map";

describe("ld2450-zone-map", () => {
  it("keeps touches on points from scrolling or zooming the page", async () => {
    const map = document.createElement("ld2450-zone-map") as Ld2450ZoneMap;
    map.editable = true;
    map.draft = [
      { x: 0, y: 1000 },
      { x: 1000, y: 1000 },
      { x: 1000, y: 2000 },
    ];
    document.body.appendChild(map);
    await map.updateComplete;
    const vertex = map.shadowRoot!.querySelector("g.vertex")!;
    for (const type of ["touchstart", "touchmove"]) {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      vertex.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
    // Touches elsewhere on the map still scroll the page
    const ev = new Event("touchstart", { bubbles: true, cancelable: true });
    map.shadowRoot!.querySelector("svg")!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe("ld2450-zone-map fitting", () => {
  async function viewBox(setup: (map: Ld2450ZoneMap) => void): Promise<number[]> {
    const map = document.createElement("ld2450-zone-map") as Ld2450ZoneMap;
    setup(map);
    document.body.appendChild(map);
    await map.updateComplete;
    return map.shadowRoot!.querySelector("svg")!.getAttribute("viewBox")!.split(" ").map(Number);
  }

  it("fits only what's shown", async () => {
    const all = await viewBox(() => undefined);
    const zone = [
      { x: -500, y: 1000 },
      { x: 500, y: 1000 },
      { x: 500, y: 2000 },
    ];
    const zoneOnly = await viewBox((map) => {
      map.overlays = { trackingRange: false, pointLimits: false, floorPlan: false };
      map.zones = [{ name: "Couch", points: zone, selected: true, occupied: false }];
    });
    // The zone and the radar need far less room than the tracking range and limits
    expect(zoneOnly[2]).toBeLessThan(all[2] / 2);
  });

  it("fits the tracking range when nothing else is shown", async () => {
    const all = await viewBox(() => undefined);
    const nothingShown = await viewBox((map) => {
      map.overlays = { trackingRange: false, pointLimits: false, floorPlan: false };
    });
    expect(nothingShown[3]).toBeGreaterThan(all[3] * 0.9);
  });
});
