import { describe, expect, it } from "vitest";
import { CONFIG_FORM, configOverrides } from "./config-form";

describe("configOverrides", () => {
  it("keeps complete items", () => {
    const config = {
      device_id: "dev1",
      targets: [{ xy: "sensor.target_1_xy" }],
      zones: [{ polygon: "text.couch", presence: "binary_sensor.couch" }],
    };
    expect(configOverrides(config)).toEqual(config);
  });

  it("leaves out items still being filled in", () => {
    expect(
      configOverrides({
        device_id: "",
        targets: [{ xy: "" }, {} as never, { xy: "sensor.target_1_xy" }],
        zones: [{ polygon: "" }, { polygon: "text.couch", presence: "" }],
      }),
    ).toEqual({
      device_id: undefined,
      targets: [{ xy: "sensor.target_1_xy" }],
      zones: [{ polygon: "text.couch", presence: undefined }],
    });
  });

  it("labels and explains the fields", () => {
    for (const field of CONFIG_FORM.schema) expect(CONFIG_FORM.computeLabel(field)).toBeTruthy();
    expect(CONFIG_FORM.computeHelper({ name: "zones" })).toContain("Occupied");
  });
});
