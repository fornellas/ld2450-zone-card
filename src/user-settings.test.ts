import { describe, expect, it } from "vitest";
import type { HomeAssistant } from "./ha-types";
import { fetchUserSettings } from "./user-settings";

const hassWith = (value: unknown) => ({ callWS: () => Promise.resolve({ value }) }) as unknown as HomeAssistant;

describe("fetchUserSettings", () => {
  it("drops the removed zone point limits toggle", async () => {
    const settings = await fetchUserSettings(
      hassWith({ units: "metric", overlays: { pointLimits: false, floorPlan: false } }),
    );
    expect(settings).toEqual({ units: "metric", overlays: { floorPlan: false } });
  });

  it("keeps other settings as they are", async () => {
    expect(await fetchUserSettings(hassWith({ snap: false }))).toEqual({ snap: false });
    expect(await fetchUserSettings(hassWith(null))).toEqual({});
  });
});
