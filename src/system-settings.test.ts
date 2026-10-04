import { describe, expect, it } from "vitest";
import { deviceMount, withDeviceMount } from "./system-settings";
import { DEFAULT_MOUNT } from "./transform";

describe("system settings", () => {
  const mount = { upsideDown: true, rotation: 90, offset: { x: 100, y: -200 } };

  it("reads a device's mount", () => {
    expect(deviceMount({ mounts: { dev1: mount } }, "dev1")).toEqual(mount);
  });

  it.each([
    undefined,
    {},
    { mounts: {} },
    { mounts: { dev1: { upsideDown: "yes", rotation: 0, offset: { x: 0, y: 0 } } } },
  ])("defaults when missing or malformed: %o", (settings) => {
    expect(deviceMount(settings as never, "dev1")).toEqual(DEFAULT_MOUNT);
  });

  it("sets a device's mount without touching others", () => {
    const other = { ...DEFAULT_MOUNT, rotation: 10 };
    expect(withDeviceMount({ mounts: { dev2: other } }, "dev1", mount)).toEqual({
      mounts: { dev1: mount, dev2: other },
    });
  });
});
