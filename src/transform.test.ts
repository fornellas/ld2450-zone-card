import { describe, expect, it } from "vitest";
import { DEFAULT_MOUNT, type Mount, toRadar, toRoom } from "./transform";

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe("transform", () => {
  it("is the identity by default", () => {
    close(toRoom({ x: -782, y: 1713 }, DEFAULT_MOUNT), { x: -782, y: 1713 });
  });

  it("mirrors x when inverted", () => {
    close(toRoom({ x: 100, y: 200 }, { ...DEFAULT_MOUNT, invertX: true }), { x: -100, y: 200 });
  });

  it("rotates counter-clockwise", () => {
    close(toRoom({ x: 0, y: 1000 }, { ...DEFAULT_MOUNT, rotation: 90 }), { x: -1000, y: 0 });
    close(toRoom({ x: 1000, y: 0 }, { ...DEFAULT_MOUNT, rotation: 90 }), { x: 0, y: 1000 });
  });

  it("offsets the radar position", () => {
    close(toRoom({ x: 0, y: 0 }, { ...DEFAULT_MOUNT, offset: { x: 500, y: -300 } }), { x: 500, y: -300 });
  });

  it.each<Mount>([
    DEFAULT_MOUNT,
    { invertX: true, rotation: 0, offset: { x: 0, y: 0 } },
    { invertX: false, rotation: 37, offset: { x: 1200, y: -450 } },
    { invertX: true, rotation: -135, offset: { x: -3000, y: 2500 } },
  ])("round-trips with %o", (mount) => {
    for (const p of [
      { x: 0, y: 0 },
      { x: -4860, y: 7560 },
      { x: 1234, y: 567 },
    ]) {
      close(toRadar(toRoom(p, mount), mount), p);
    }
  });
});
