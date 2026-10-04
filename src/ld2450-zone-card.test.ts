// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { HomeAssistant } from "./ha-types";
import "./ld2450-zone-card";
import type { Ld2450ZoneCard } from "./ld2450-zone-card";
import { POLYGON_PATTERN } from "./polygon";

let calls: { type: string; [key: string]: unknown }[] = [];
let systemData: unknown = null;

function hass(): HomeAssistant {
  calls = [];
  systemData = null;
  const states: HomeAssistant["states"] = {};
  const entities: HomeAssistant["entities"] = {};
  const add = (entity_id: string, state: string, attributes: Record<string, unknown>) => {
    states[entity_id] = { entity_id, state, attributes, last_changed: "", last_updated: "" };
    entities[entity_id] = { entity_id, device_id: "dev1", platform: "esphome" };
  };
  const polygon = { min: 0, max: 255, pattern: POLYGON_PATTERN };
  add("text.couch", "0,0;1000,0;1000,600", { ...polygon, friendly_name: "Office Couch Zone" });
  add("text.desk", "", { ...polygon, friendly_name: "Office Desk Zone" });
  add("binary_sensor.couch", "on", { friendly_name: "Office Couch Occupied", device_class: "occupancy" });
  add("sensor.t1_x", "-782", {
    friendly_name: "Office Target 1 X",
    unit_of_measurement: "mm",
    device_class: "distance",
    icon: "mdi:alpha-x-box-outline",
  });
  add("sensor.t1_y", "1713", {
    friendly_name: "Office Target 1 Y",
    unit_of_measurement: "mm",
    device_class: "distance",
    icon: "mdi:alpha-y-box-outline",
  });
  return {
    states,
    entities,
    devices: { dev1: { id: "dev1", name: "Office", name_by_user: null } },
    config: { unit_system: { length: "km" } },
    user: { is_admin: true },
    connection: {
      subscribeMessage: <T>(callback: (event: T) => void, msg: { type: string; [key: string]: unknown }) => {
        calls.push(msg);
        callback({ value: systemData } as T);
        return Promise.resolve(() => undefined);
      },
    },
    callWS: <T>(msg: { type: string; [key: string]: unknown }) => {
      calls.push(msg);
      if (msg.type === "config/entity_registry/settings/get") {
        return Promise.resolve({ entity_id_parts: ["area", "device", "entity"] } as T);
      }
      if (msg.type === "frontend/get_user_data") return Promise.resolve({ value: null } as T);
      return Promise.resolve(null as T);
    },
  };
}

async function renderCard(config: Record<string, unknown>, h: HomeAssistant): Promise<ShadowRoot> {
  const card = document.createElement("ld2450-zone-card") as Ld2450ZoneCard;
  card.setConfig({ type: "custom:ld2450-zone-card", ...config });
  card.hass = h;
  document.body.appendChild(card);
  // The first render waits for the entity ID format
  await card.updateComplete;
  await new Promise((resolve) => setTimeout(resolve));
  await card.updateComplete;
  return card.shadowRoot!;
}

describe("ld2450-zone-card", () => {
  it("lists devices and zones", async () => {
    const root = await renderCard({}, hass());
    const selects = root.querySelectorAll("select");
    expect([...selects[0].options].map((o) => o.textContent)).toEqual(["Office"]);
    expect([...selects[1].options].map((o) => o.textContent)).toEqual(["Couch Zone", "Desk Zone"]);
    expect(root.textContent).toContain("3 points");
    expect(root.textContent).toContain("binary_sensor.couch");
  });

  it("shows the selected zone", async () => {
    const root = await renderCard({}, hass());
    const zoneSelect = root.querySelectorAll("select")[1];
    zoneSelect.value = "text.desk";
    zoneSelect.dispatchEvent(new Event("change"));
    await (root.host as Ld2450ZoneCard).updateComplete;
    expect(root.textContent).toContain("disabled (no polygon)");
  });

  it("explains when nothing is found", async () => {
    const root = await renderCard({}, { ...hass(), states: {}, entities: {} });
    expect(root.textContent).toContain("No LD2450 polygon zones found");
  });

  it("draws the map and switches units per user", async () => {
    const root = await renderCard({}, hass());
    const map = root.querySelector("ld2450-zone-map")!;
    await (map as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(map.shadowRoot!.querySelector("polygon.area")).not.toBeNull();
    expect(map.shadowRoot!.textContent).toContain("2 m");
    expect(map.shadowRoot!.querySelectorAll("g.target")).toHaveLength(1);
    // The couch zone has a polygon and is occupied; the desk zone is empty and not drawn
    const zones = map.shadowRoot!.querySelectorAll("g.zone");
    expect(zones).toHaveLength(1);
    expect(zones[0].getAttribute("class")).toContain("selected");
    expect(zones[0].getAttribute("class")).toContain("occupied");
    expect(zones[0].textContent).toContain("Couch Zone");
    expect(map.shadowRoot!.querySelector(".readout")!.textContent).toContain("x -0.78 m, y 1.71 m");

    const imperial = [...root.querySelectorAll(".segmented button")].find((b) => b.textContent?.includes("Imperial"));
    (imperial as HTMLButtonElement).click();
    await (root.host as Ld2450ZoneCard).updateComplete;
    await (map as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(map.shadowRoot!.textContent).toContain("10 ft");
    expect(calls).toContainEqual({
      type: "frontend/set_user_data",
      key: "ld2450_zone_card",
      value: { units: "imperial" },
    });
  });

  it("uses the saved radar position and saves changes", async () => {
    const h = hass();
    systemData = { mounts: { dev1: { invertX: true, rotation: 0, offset: { x: 0, y: 0 } } } };
    const root = await renderCard({}, h);
    const map = root.querySelector("ld2450-zone-map") as unknown as {
      mount: unknown;
      updateComplete: Promise<unknown>;
    };
    expect(map.mount).toEqual({ invertX: true, rotation: 0, offset: { x: 0, y: 0 } });
    // Inverting mirrors the radar's x
    await map.updateComplete;
    expect((map as unknown as HTMLElement).shadowRoot!.querySelector(".readout")!.textContent).toContain("x 0.78 m");

    const mount = { invertX: false, rotation: 45, offset: { x: 1000, y: 0 } };
    root.querySelector("ld2450-mount-editor")!.dispatchEvent(new CustomEvent("mount-changed", { detail: mount }));
    await (root.host as Ld2450ZoneCard).updateComplete;
    expect(map.mount).toEqual(mount);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(calls).toContainEqual({
      type: "frontend/set_system_data",
      key: "ld2450_zone_card",
      value: { mounts: { dev1: mount } },
    });
  });

  it("does not let non-admins change the radar position", async () => {
    const root = await renderCard({}, { ...hass(), user: { is_admin: false } });
    expect((root.querySelector("ld2450-mount-editor") as unknown as { disabled: boolean }).disabled).toBe(true);
  });

  describe("editing", () => {
    async function edit() {
      const root = await renderCard({}, hass());
      const card = root.host as Ld2450ZoneCard;
      const update = async () => {
        await card.updateComplete;
      };
      const textarea = () => root.querySelector("textarea")!;
      const deviceValue = () => root.querySelector(".device-value code")!.textContent;
      const button = (label: string) =>
        [...root.querySelectorAll(".edit-toolbar button")].find((b) =>
          b.textContent!.includes(label),
        ) as HTMLButtonElement;
      const type = async (value: string) => {
        textarea().value = value;
        textarea().dispatchEvent(new Event("input"));
        await update();
      };
      return { root, update, textarea, deviceValue, button, type };
    }

    it("starts from the device's polygon", async () => {
      const { textarea, deviceValue, root, button } = await edit();
      expect(textarea().value).toBe("0,0;1000,0;1000,600");
      expect(deviceValue()).toBe("0,0;1000,0;1000,600");
      expect(root.querySelector(".dirty")).toBeNull();
      expect(button("Revert").disabled).toBe(true);
    });

    it("edits the polygon from the text", async () => {
      const { type, deviceValue, root, button } = await edit();
      await type("0,0;2000,0;2000,600;0,600");
      expect(deviceValue()).toBe("0,0;2000,0;2000,600;0,600");
      expect(root.querySelector(".dirty")).not.toBeNull();
      expect(root.querySelector(".status")!.textContent).toContain("4 / 23 points");
      expect(button("Revert").disabled).toBe(false);
    });

    it("explains text it can't read and keeps the last polygon", async () => {
      const { type, deviceValue, root, textarea } = await edit();
      await type("0,0;2000,0;2000");
      expect(textarea().value).toBe("0,0;2000,0;2000");
      expect(root.querySelector(".errors")!.textContent).toContain("Point 3");
      expect(deviceValue()).toBe("0,0;1000,0;1000,600");
    });

    it("flags points outside the limits", async () => {
      const { type, root } = await edit();
      await type("0,0;6000,0;0,600");
      expect(root.querySelector(".errors")!.textContent).toContain("Point 2 is outside");
    });

    it("clears and reverts", async () => {
      const { button, update, deviceValue, textarea } = await edit();
      button("Clear").click();
      await update();
      expect(deviceValue()).toBe("(empty: zone disabled)");
      expect(textarea().value).toBe("");
      button("Revert").click();
      await update();
      expect(deviceValue()).toBe("0,0;1000,0;1000,600");
    });

    it("applies edits from the map", async () => {
      const { root, update, deviceValue } = await edit();
      const draft = [
        { x: 0, y: 0 },
        { x: 500.4, y: 0 },
        { x: 500, y: 500 },
      ];
      root.querySelector("ld2450-zone-map")!.dispatchEvent(new CustomEvent("draft-changed", { detail: draft }));
      await update();
      expect(deviceValue()).toBe("0,0;500,0;500,500");
    });

    it("shows room coordinates and writes radar coordinates", async () => {
      systemData = null;
      const h = hass();
      systemData = { mounts: { dev1: { invertX: true, rotation: 0, offset: { x: 1000, y: 0 } } } };
      const root = await renderCard({}, h);
      // Radar (1000,0) -> inverted (-1000,0) -> offset (0,0)
      expect(root.querySelector("textarea")!.value).toBe("1000,0;0,0;0,600");
      expect(root.querySelector(".device-value code")!.textContent).toBe("0,0;1000,0;1000,600");
    });
  });

  it("rejects invalid config", () => {
    const card = document.createElement("ld2450-zone-card") as Ld2450ZoneCard;
    const config = { type: "custom:ld2450-zone-card", targets: [{ x: "sensor.x" }] };
    expect(() => card.setConfig(config as Parameters<Ld2450ZoneCard["setConfig"]>[0])).toThrow(/"y"/);
  });
});
