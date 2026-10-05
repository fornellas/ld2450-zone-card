import { describe, expect, it } from "vitest";
import { deviceFloorPlan, deviceMount, withDeviceMount, withFloorPlan } from "./system-settings";
import { DEFAULT_MOUNT } from "./transform";

describe("system settings", () => {
  const mount = { invertX: true, rotation: 90, offset: { x: 100, y: -200 } };

  it("reads a device's mount", () => {
    expect(deviceMount({ mounts: { dev1: mount } }, "dev1")).toEqual(mount);
  });

  it.each([
    undefined,
    {},
    { mounts: {} },
    { mounts: { dev1: { invertX: "yes", rotation: 0, offset: { x: 0, y: 0 } } } },
  ])("defaults when missing or malformed: %o", (settings) => {
    expect(deviceMount(settings as never, "dev1")).toEqual(DEFAULT_MOUNT);
  });

  it.each([
    [true, false],
    [false, true],
  ])("converts v0.0.8 upsideDown %s to invertX %s", (upsideDown, invertX) => {
    const old = { upsideDown, rotation: 10, offset: { x: 1, y: 2 } };
    expect(deviceMount({ mounts: { dev1: old as never } }, "dev1")).toEqual({
      invertX,
      rotation: 10,
      offset: { x: 1, y: 2 },
    });
  });

  it("reads and sets a device's floor plan", () => {
    const plan = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
    ];
    const settings = withFloorPlan({ mounts: {} }, "dev1", plan);
    expect(settings.floorPlans).toEqual({ dev1: { points: plan } });
    expect(deviceFloorPlan(settings, "dev1")).toEqual(plan);
    expect(deviceFloorPlan(settings, "dev2")).toEqual([]);
    expect(deviceFloorPlan({ floorPlans: { dev1: { points: [{ x: "a" }] } as never } }, "dev1")).toEqual([]);
    expect(settings.mounts).toEqual({});
  });

  it("converts v0.0.14 floor plans from room coordinates", () => {
    const mount = { invertX: false, rotation: 0, offset: { x: 1000, y: 0 } };
    const settings = { mounts: { dev1: mount }, floorPlans: { dev1: [{ x: 1000, y: 500 }] } };
    expect(deviceFloorPlan(settings, "dev1")).toEqual([{ x: 0, y: 500 }]);
  });

  it("sets a device's mount without touching others", () => {
    const other = { ...DEFAULT_MOUNT, rotation: 10 };
    expect(withDeviceMount({ mounts: { dev2: other } }, "dev1", mount)).toEqual({
      mounts: { dev1: mount, dev2: other },
    });
  });
});
