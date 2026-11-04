import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeAssistant } from "./ha-types";
import { PRESS_INTERVAL_MS, holdUnfiltered } from "./unfiltered";

describe("holdUnfiltered", () => {
  const pressed: string[] = [];
  const hass = {
    callService: (domain: string, service: string, _data: unknown, target: { entity_id: string }) => {
      pressed.push(`${domain}.${service} ${target.entity_id}`);
      return Promise.resolve();
    },
  } as unknown as HomeAssistant;

  beforeEach(() => {
    pressed.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("presses the button at once, then keeps pressing it", () => {
    const release = holdUnfiltered("button.xy", () => hass);
    expect(pressed).toEqual(["button.press button.xy"]);
    vi.advanceTimersByTime(PRESS_INTERVAL_MS * 2);
    expect(pressed).toHaveLength(3);
    release();
  });

  it("stops pressing when released, without pressing anything else", () => {
    const release = holdUnfiltered("button.xy", () => hass);
    release();
    vi.advanceTimersByTime(PRESS_INTERVAL_MS * 5);
    expect(pressed).toEqual(["button.press button.xy"]);
  });

  it("presses once for all the users of a button, until the last one is done", () => {
    const first = holdUnfiltered("button.xy", () => hass);
    const second = holdUnfiltered("button.xy", () => hass);
    expect(pressed).toHaveLength(1);
    vi.advanceTimersByTime(PRESS_INTERVAL_MS);
    expect(pressed).toHaveLength(2);
    first();
    vi.advanceTimersByTime(PRESS_INTERVAL_MS);
    expect(pressed).toHaveLength(3);
    second();
    vi.advanceTimersByTime(PRESS_INTERVAL_MS * 5);
    expect(pressed).toHaveLength(3);
  });

  it("presses each button on its own", () => {
    const a = holdUnfiltered("button.a", () => hass);
    const b = holdUnfiltered("button.b", () => hass);
    a();
    vi.advanceTimersByTime(PRESS_INTERVAL_MS);
    expect(pressed).toEqual(["button.press button.a", "button.press button.b", "button.press button.b"]);
    b();
  });

  it("keeps going after a failed press, warning once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failing = { callService: () => Promise.reject(new Error("no")) } as unknown as HomeAssistant;
    const release = holdUnfiltered("button.xy", () => failing);
    await vi.advanceTimersByTimeAsync(PRESS_INTERVAL_MS * 3);
    expect(warn).toHaveBeenCalledTimes(1);
    release();
    warn.mockRestore();
  });
});
