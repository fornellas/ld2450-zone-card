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

describe("ld2450-zone-map snapping", () => {
  async function map(snapToPoints: boolean) {
    const el = document.createElement("ld2450-zone-map") as Ld2450ZoneMap;
    el.editable = true;
    el.snapStep = 100;
    el.snapToPoints = snapToPoints;
    el.draft = [
      { x: 0, y: 1000 },
      { x: 500, y: 1000 },
      { x: 500, y: 1500 },
    ];
    el.zones = [
      { name: "Desk", points: [{ x: 1234, y: 2345 }], selected: false, occupied: false },
      { name: "Couch", points: [{ x: -1234, y: 2345 }], selected: true, occupied: false },
    ];
    el.floorPlan = [{ x: 3333, y: 4444 }];
    document.body.appendChild(el);
    await el.updateComplete;
    // The radar coordinates a dragged point lands on, from the room point under the pointer
    return (room: { x: number; y: number }) =>
      (el as unknown as { _toDraftPoint(p: { x: number; y: number }): { x: number; y: number } })._toDraftPoint(room);
  }

  const round = (p: { x: number; y: number }) => ({ x: Math.round(p.x), y: Math.round(p.y) });

  it("snaps onto nearby points of other zones and the floor plan", async () => {
    const land = await map(true);
    expect(round(land({ x: 1250, y: 2330 }))).toEqual({ x: 1234, y: 2345 });
    expect(round(land({ x: 3300, y: 4400 }))).toEqual({ x: 3333, y: 4444 });
  });

  it("doesn't snap onto the zone being edited", async () => {
    const land = await map(true);
    expect(round(land({ x: -1270, y: 2330 }))).toEqual({ x: -1300, y: 2300 });
  });

  it("uses the grid when far from points, or when off", async () => {
    expect(round((await map(true))({ x: 2000, y: 3030 }))).toEqual({ x: 2000, y: 3000 });
    expect(round((await map(false))({ x: 1250, y: 2330 }))).toEqual({ x: 1300, y: 2300 });
  });
});
