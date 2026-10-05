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
