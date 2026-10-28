// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { HomeAssistant } from "./ha-types";
import "./ld2450-zone-card";
import { Ld2450ZoneCard } from "./ld2450-zone-card";
import { POLYGON_PATTERN, formatPolygon, type Point } from "./polygon";

let calls: { type: string; [key: string]: unknown }[] = [];
let systemData: unknown = null;
let onService: (data: Record<string, unknown>, target?: { entity_id: string }) => Promise<unknown> = () =>
  Promise.resolve();

function hass(): HomeAssistant {
  calls = [];
  systemData = null;
  onService = () => Promise.resolve();
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
  add("sensor.t1_xy", "-782,1713", { friendly_name: "Office Target 1 XY", icon: "mdi:crosshairs-gps" });
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
    callService: (domain: string, service: string, data?: Record<string, unknown>, target?: { entity_id: string }) => {
      calls.push({ type: `${domain}.${service}`, ...data, ...target });
      return onService(data ?? {}, target);
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

/** The polygon the card is editing, in room coordinates. */
function drawn(root: ShadowRoot): string {
  return formatPolygon((root.querySelector("ld2450-zone-map") as unknown as { draft: Point[] }).draft);
}

/** Points from "x,y;x,y" text. */
function points(text: string): Point[] {
  return text === "" ? [] : text.split(";").map((p) => ({ x: Number(p.split(",")[0]), y: Number(p.split(",")[1]) }));
}

/** Edit the polygon from the map, as dragging or clicking does, in room coordinates. */
async function draw(root: ShadowRoot, text: string, gesture?: string): Promise<void> {
  root
    .querySelector("ld2450-zone-map")!
    .dispatchEvent(new CustomEvent("draft-changed", { detail: { points: points(text), gesture } }));
  await (root.host as Ld2450ZoneCard).updateComplete;
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
    expect([...selects[1].options].map((o) => o.textContent)).toEqual(["Couch Zone", "Desk Zone", "Floor plan"]);
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
    expect(root.querySelector(".targets")!.textContent).toContain("x -0.78 m, y 1.71 m");

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
    expect(root.querySelector(".targets")!.textContent).toContain("x 0.78 m");

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
      const deviceValue = () => drawn(root);
      const button = (label: string) =>
        [...root.querySelectorAll(".edit-toolbar button")].find((b) =>
          b.textContent!.includes(label),
        ) as HTMLButtonElement;
      const type = (value: string) => draw(root, value);
      return { root, update, deviceValue, button, type };
    }

    it("starts from the device's polygon", async () => {
      const { deviceValue, root, button } = await edit();
      expect(deviceValue()).toBe("0,0;1000,0;1000,600");
      expect(root.querySelector(".dirty")).toBeNull();
      expect(button("Revert").disabled).toBe(true);
    });

    it("edits the polygon from the map", async () => {
      const { type, deviceValue, root, button } = await edit();
      await type("0,0;2000,0;2000,600;0,600");
      expect(deviceValue()).toBe("0,0;2000,0;2000,600;0,600");
      expect(root.querySelector(".dirty")).not.toBeNull();
      expect(button("Revert").disabled).toBe(false);
    });

    it("clears and reverts", async () => {
      const { button, update, deviceValue } = await edit();
      button("Clear").click();
      await update();
      expect(deviceValue()).toBe("");
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
      root
        .querySelector("ld2450-zone-map")!
        .dispatchEvent(new CustomEvent("draft-changed", { detail: { points: draft } }));
      await update();
      expect(deviceValue()).toBe("0,0;500,0;500,500");
    });

    describe("undo", () => {
      const square = (size: number) => [
        { x: 0, y: 0 },
        { x: size, y: 0 },
        { x: size, y: size },
      ];

      async function undoable() {
        const env = await edit();
        const map = env.root.querySelector("ld2450-zone-map")!;
        const change = async (points: { x: number; y: number }[], gesture?: string) => {
          map.dispatchEvent(new CustomEvent("draft-changed", { detail: { points, gesture } }));
          await env.update();
        };
        const key = async (key: string, shiftKey = false, from: Element = map) => {
          from.dispatchEvent(
            new KeyboardEvent("keydown", { key, ctrlKey: true, shiftKey, bubbles: true, composed: true }),
          );
          await env.update();
        };
        return { ...env, change, key };
      }

      it("undoes and redoes with the buttons", async () => {
        const { change, button, deviceValue, update } = await undoable();
        expect(button("Undo").disabled).toBe(true);
        await change(square(500));
        await change(square(700));
        button("Undo").click();
        await update();
        expect(deviceValue()).toBe("0,0;500,0;500,500");
        button("Undo").click();
        await update();
        expect(deviceValue()).toBe("0,0;1000,0;1000,600");
        expect(button("Undo").disabled).toBe(true);
        button("Redo").click();
        await update();
        expect(deviceValue()).toBe("0,0;500,0;500,500");
      });

      it("undoes a drag in one step", async () => {
        const { change, button, deviceValue, update } = await undoable();
        await change(square(500), "drag-1");
        await change(square(600), "drag-1");
        await change(square(700), "drag-1");
        button("Undo").click();
        await update();
        expect(deviceValue()).toBe("0,0;1000,0;1000,600");
      });

      it("undoes with Ctrl+Z and redoes with Ctrl+Shift+Z", async () => {
        const { change, key, deviceValue } = await undoable();
        await change(square(500));
        await key("z");
        expect(deviceValue()).toBe("0,0;1000,0;1000,600");
        await key("Z", true);
        expect(deviceValue()).toBe("0,0;500,0;500,500");
      });

      it("leaves Ctrl+Z in text fields to the field", async () => {
        const { change, key, deviceValue, root } = await undoable();
        await change(square(500));
        await key("z", false, root.querySelector(".point input")!);
        expect(deviceValue()).toBe("0,0;500,0;500,500");
      });

      it("undoes Revert, and a new change clears redo", async () => {
        const { change, button, deviceValue, update } = await undoable();
        await change(square(500));
        button("Revert").click();
        await update();
        button("Undo").click();
        await update();
        expect(deviceValue()).toBe("0,0;500,0;500,500");
        await change(square(800));
        expect(button("Redo").disabled).toBe(true);
      });
    });

    describe("saving", () => {
      async function editAndSave() {
        const env = await edit();
        await env.type("0,0;2000,0;2000,600");
        const card = env.root.host as Ld2450ZoneCard;
        return { ...env, card };
      }

      it("writes the polygon and confirms when the device publishes it", async () => {
        const { card, button, update, root, deviceValue } = await editAndSave();
        onService = (data, target) => {
          // The device accepts it and publishes it back
          const states = { ...card.hass!.states };
          states[target!.entity_id] = { ...states[target!.entity_id], state: String(data.value) };
          setTimeout(() => (card.hass = { ...card.hass!, states }));
          return Promise.resolve();
        };
        button("Save").click();
        await update();
        expect(calls).toContainEqual({ type: "text.set_value", value: "0,0;2000,0;2000,600", entity_id: "text.couch" });
        await new Promise((resolve) => setTimeout(resolve, 10));
        await update();
        expect(root.querySelector(".saved")!.textContent).toContain("Saved");
        expect(root.querySelector(".dirty")).toBeNull();
        expect(deviceValue()).toBe("0,0;2000,0;2000,600");
        expect(button("Save").disabled).toBe(true);
      });

      it("keeps the changes when the device rejects them", async () => {
        Ld2450ZoneCard.saveTimeoutMs = 20;
        try {
          const { button, update, root, deviceValue } = await editAndSave();
          button("Save").click();
          await new Promise((resolve) => setTimeout(resolve, 50));
          await update();
          expect(root.querySelector("p.error")!.textContent).toContain('kept "0,0;1000,0;1000,600"');
          expect(deviceValue()).toBe("0,0;2000,0;2000,600");
          expect(root.querySelector(".dirty")).not.toBeNull();
          expect(button("Save").disabled).toBe(false);
        } finally {
          Ld2450ZoneCard.saveTimeoutMs = 5000;
        }
      });

      it("keeps the changes when HA refuses them", async () => {
        const { button, update, root, deviceValue } = await editAndSave();
        onService = () => Promise.reject(new Error("Value does not match pattern"));
        button("Save").click();
        await new Promise((resolve) => setTimeout(resolve));
        await update();
        expect(root.querySelector("p.error")!.textContent).toContain("Value does not match pattern");
        expect(deviceValue()).toBe("0,0;2000,0;2000,600");
      });

      it("can't save zones with too few points", async () => {
        const { type, button } = await edit();
        await type("0,0;6000,0");
        expect(button("Save").disabled).toBe(true);
      });

      it("tells when the device rejects a point it can't take", async () => {
        Ld2450ZoneCard.saveTimeoutMs = 20;
        try {
          const { type, button, update, root, deviceValue } = await edit();
          // Far beyond what the device accepts: the card saves it, and the device publishes its old polygon back
          await type("0,0;9000,0;0,600");
          expect(button("Save").disabled).toBe(false);
          button("Save").click();
          await new Promise((resolve) => setTimeout(resolve, 50));
          await update();
          expect(calls).toContainEqual({ type: "text.set_value", value: "0,0;9000,0;0,600", entity_id: "text.couch" });
          const error = root.querySelector("p.error")!.textContent!;
          expect(error).toContain("outside the area it accepts");
          expect(error).toContain('kept "0,0;1000,0;1000,600"');
          expect(deviceValue()).toBe("0,0;9000,0;0,600");
        } finally {
          Ld2450ZoneCard.saveTimeoutMs = 5000;
        }
      });
    });

    it("shows the selected point in room coordinates, and writes radar coordinates", async () => {
      const h = hass();
      systemData = { mounts: { dev1: { invertX: true, rotation: 0, offset: { x: 1000, y: 0 } } } };
      const root = await renderCard({}, h);
      const card = root.host as Ld2450ZoneCard;
      const map = root.querySelector("ld2450-zone-map")!;
      const inputs = () => [...root.querySelectorAll<HTMLInputElement>(".point input")];
      expect(root.querySelector(".point-name")!.textContent).toBe("Point (none selected)");
      expect(inputs().every((i) => i.disabled)).toBe(true);
      // The device's zone is 0,0;1000,0;1000,600 in radar coordinates. Inverted and moved to x 1 m, that's room
      // coordinates 1000,0;0,0;0,600
      expect(drawn(root)).toBe("1000,0;0,0;0,600");
      map.dispatchEvent(new CustomEvent("vertex-selected", { detail: 1 }));
      await card.updateComplete;
      expect(root.querySelector(".point-name")!.textContent).toBe("Point 2");
      expect(inputs().map((i) => i.value)).toEqual(["0", "0"]);
      // Typing room coordinates moves the point
      inputs()[1].value = "0.5";
      inputs()[1].dispatchEvent(new Event("input"));
      await card.updateComplete;
      expect(drawn(root)).toBe("1000,0;0,500;0,600");
      // Saving writes the device's coordinates
      [...root.querySelectorAll<HTMLButtonElement>(".edit-toolbar button")]
        .find((b) => b.textContent!.includes("Save"))!
        .click();
      expect(calls).toContainEqual({ type: "text.set_value", value: "0,0;1000,500;1000,600", entity_id: "text.couch" });
    });
  });

  it("shows when the device is offline", async () => {
    const h = hass();
    for (const id of ["text.couch", "text.desk", "sensor.t1_xy"]) {
      h.states[id] = { ...h.states[id], state: "unavailable" };
    }
    const root = await renderCard({}, h);
    expect(root.querySelector("select")!.options[0].textContent).toBe("Office (offline)");
    expect(root.querySelector(".offline")!.textContent).toContain("Office is offline");
    const map = root.querySelector("ld2450-zone-map")!;
    await (map as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(root.querySelector(".targets")!.textContent).toContain("Radar offline");
    // Edits are possible, but can't be saved
    await draw(root, "0,0;1000,0;1000,600");
    const save = [...root.querySelectorAll(".edit-toolbar button")].find((b) => b.textContent!.includes("Save"));
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  it("sets the snap step per user", async () => {
    const root = await renderCard({}, hass());
    const map = root.querySelector("ld2450-zone-map") as unknown as { snapStep: number };
    expect(map.snapStep).toBe(50);
    const input = root.querySelector(".snap-step input") as HTMLInputElement;
    input.value = "0.2";
    input.dispatchEvent(new Event("input"));
    await (root.host as Ld2450ZoneCard).updateComplete;
    expect(map.snapStep).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(calls).toContainEqual({
      type: "frontend/set_user_data",
      key: "ld2450_zone_card",
      value: { snapStep: { metric: 200 } },
    });
  });

  describe("floor plan", () => {
    async function editFloorPlan(h = hass()) {
      const root = await renderCard({}, h);
      const card = root.host as Ld2450ZoneCard;
      const select = root.querySelectorAll("select")[1];
      select.value = "floor-plan";
      select.dispatchEvent(new Event("change"));
      await card.updateComplete;
      await draw(root, "-3000,-500;3000,-500;3000,6000;-3000,6000");
      const save = [...root.querySelectorAll(".edit-toolbar button")].find((b) =>
        b.textContent!.includes("Save"),
      ) as HTMLButtonElement;
      return { root, card, save };
    }

    it("is drawn in the room, and saved for everyone", async () => {
      const h = hass();
      systemData = { mounts: { dev1: { invertX: true, rotation: 0, offset: { x: 1000, y: 0 } } } };
      const { root, card, save } = await editFloorPlan(h);
      save.click();
      await new Promise((resolve) => setTimeout(resolve));
      await card.updateComplete;
      expect(calls).toContainEqual({
        type: "frontend/set_system_data",
        key: "ld2450_zone_card",
        value: {
          mounts: { dev1: { invertX: true, rotation: 0, offset: { x: 1000, y: 0 } } },
          // Stored where it's drawn in the room, whatever the radar's position
          floorPlans: {
            dev1: {
              room: [
                { x: -3000, y: -500 },
                { x: 3000, y: -500 },
                { x: 3000, y: 6000 },
                { x: -3000, y: 6000 },
              ],
            },
          },
        },
      });
      expect(root.querySelector(".saved")!.textContent).toContain("Floor plan saved");
      expect(root.querySelector(".dirty")).toBeNull();
    });

    it("can only be saved by admins", async () => {
      const { root, save } = await editFloorPlan({ ...hass(), user: { is_admin: false } });
      expect(save.disabled).toBe(true);
      expect(root.textContent).toContain("Only administrators can save the floor plan");
    });
  });

  it("shows and hides outlines per user", async () => {
    const h = hass();
    systemData = {
      floorPlans: {
        dev1: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 1000, y: 1000 },
        ],
      },
    };
    const root = await renderCard({}, h);
    const map = root.querySelector("ld2450-zone-map")! as unknown as HTMLElement & { updateComplete: Promise<unknown> };
    await map.updateComplete;
    expect(map.shadowRoot!.querySelector("polygon.floor-plan")).not.toBeNull();
    const toggles = [...map.shadowRoot!.querySelectorAll<HTMLButtonElement>("button.toggle")];
    expect(toggles).toHaveLength(5);
    expect(toggles[1].getAttribute("aria-pressed")).toBe("true");
    toggles[1].click();
    await (root.host as Ld2450ZoneCard).updateComplete;
    await map.updateComplete;
    expect(map.shadowRoot!.querySelector("polygon.floor-plan")).toBeNull();
    expect(calls).toContainEqual({
      type: "frontend/set_user_data",
      key: "ld2450_zone_card",
      value: { overlays: { floorPlan: false } },
    });
  });

  describe("trail", () => {
    async function withTrail() {
      const h = hass();
      const root = await renderCard({}, h);
      const card = root.host as Ld2450ZoneCard;
      const map = root.querySelector("ld2450-zone-map")! as unknown as HTMLElement & {
        updateComplete: Promise<unknown>;
      };
      const update = async () => {
        await card.updateComplete;
        await map.updateComplete;
      };
      const circles = () => map.shadowRoot!.querySelectorAll(".trail circle").length;
      /** Set what target 1's xy text sensor says in Home Assistant. */
      const setState = async (state: string) => {
        const states = { ...card.hass!.states };
        states["sensor.t1_xy"] = { ...states["sensor.t1_xy"], state };
        card.hass = { ...card.hass!, states };
        await update();
      };
      const move = (x: number, y: number) => setState(`${x},${y}`);
      const idle = () => setState("NA");
      const toggle = async (on: boolean) => {
        const input = root.querySelector<HTMLInputElement>(".trail input")!;
        input.checked = on;
        input.dispatchEvent(new Event("change"));
        await update();
      };
      await update();
      // Start without a target, so the trail begins empty
      await idle();
      return { root, map, circles, move, idle, toggle, update };
    }

    it("fits the zone around the trail, as an edit that can be undone", async () => {
      const { root, move, toggle, update } = await withTrail();
      await toggle(true);
      await move(0, 1000);
      await move(1000, 1000);
      await move(500, 2000);
      const button = (label: string) =>
        [...root.querySelectorAll("button")].find((b) => b.textContent!.includes(label)) as HTMLButtonElement;
      const margin = root.querySelector(".trail .margin input") as HTMLInputElement;
      expect(margin.value).toBe("0.3");
      button("Fit zone to trail").click();
      await update();
      const value = drawn(root);
      const points = value.split(";").map((p) => p.split(",").map(Number));
      expect(points.length).toBeGreaterThanOrEqual(3);
      expect(points.length).toBeLessThanOrEqual(23);
      // At least the margin beyond the trail: the trail spans x 0..1000 and y 1000..2000
      expect(Math.min(...points.map(([x]) => x))).toBeLessThanOrEqual(-300);
      expect(Math.max(...points.map(([, y]) => y))).toBeGreaterThanOrEqual(2300);
      button("Undo").click();
      await update();
      expect(drawn(root)).toBe("0,0;1000,0;1000,600");
    });

    it("isn't offered for the floor plan", async () => {
      const { root, toggle, update } = await withTrail();
      await toggle(true);
      expect(root.querySelector(".trail .fit")).not.toBeNull();
      const select = root.querySelectorAll("select")[1];
      select.value = "floor-plan";
      select.dispatchEvent(new Event("change"));
      await update();
      expect(root.querySelector(".trail .fit")).toBeNull();
    });

    it("is off until turned on", async () => {
      const { circles, move } = await withTrail();
      await move(100, 1000);
      expect(circles()).toBe(0);
    });

    it("keeps where targets have been seen, once per position", async () => {
      const { circles, move, toggle } = await withTrail();
      await toggle(true);
      // Not saved: it's off again on every load
      expect(calls.filter((c) => c.type === "frontend/set_user_data")).toEqual([]);
      await move(100, 1000);
      // The same position published again isn't recorded twice
      await move(100, 1000);
      await move(200, 1100);
      expect(circles()).toBe(2);
    });

    it("records each position the sensor publishes, and nothing without a target", async () => {
      const { circles, move, idle, toggle } = await withTrail();
      await toggle(true);
      await move(100, 1000);
      await move(300, 1400);
      expect(circles()).toBe(2);
      await idle();
      expect(circles()).toBe(2);
      await move(500, 1800);
      expect(circles()).toBe(3);
    });

    it("clears with the button, and when turned off", async () => {
      const { root, circles, move, toggle, update } = await withTrail();
      await toggle(true);
      await move(100, 1000);
      (root.querySelector(".trail button.clear") as HTMLButtonElement).click();
      await update();
      expect(circles()).toBe(0);
      await move(200, 1100);
      expect(circles()).toBe(1);
      await toggle(false);
      expect(circles()).toBe(0);
      // Turned on again, it starts afresh from where the target is now
      await toggle(true);
      expect(circles()).toBe(1);
      await move(300, 1200);
      expect(circles()).toBe(2);
    });
  });

  describe("radar position", () => {
    const plan = [
      { x: -2000, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 3000 },
    ];
    // Moves the radar 1 m to the right in the room
    const moved = { invertX: false, rotation: 0, offset: { x: 1000, y: 0 } };

    async function setup() {
      const h = hass();
      systemData = {
        mounts: { dev1: { invertX: false, rotation: 0, offset: { x: 0, y: 0 } } },
        floorPlans: { dev1: { room: plan } },
      };
      const root = await renderCard({}, h);
      const card = root.host as Ld2450ZoneCard;
      const map = root.querySelector("ld2450-zone-map") as unknown as {
        mount: unknown;
        zones: { name: string; points: Point[] }[];
        floorPlan: Point[];
      };
      const changeMount = async (mount: unknown) => {
        root.querySelector("ld2450-mount-editor")!.dispatchEvent(new CustomEvent("mount-changed", { detail: mount }));
        await card.updateComplete;
      };
      const options = () => [...root.querySelectorAll("select")[1].options].map((o) => o.textContent);
      return { root, card, map, changeMount, options };
    }

    it("moves the radar and the targets, but not the zones or the floor plan", async () => {
      const { root, map, changeMount } = await setup();
      expect(root.querySelector(".targets")!.textContent).toContain("x -0.78 m, y 1.71 m");
      await changeMount(moved);
      expect(map.mount).toEqual(moved);
      // Target 1 is at -782,1713 from the radar
      expect(root.querySelector(".targets")!.textContent).toContain("x 0.22 m, y 1.71 m");
      expect(drawn(root)).toBe("0,0;1000,0;1000,600");
      expect(map.floorPlan).toEqual(plan);
    });

    it("keeps zones that aren't being edited in place too", async () => {
      const { root, card, map, changeMount } = await setup();
      await changeMount(moved);
      const select = root.querySelectorAll("select")[1];
      select.value = "text.desk";
      select.dispatchEvent(new Event("change"));
      await card.updateComplete;
      expect(map.zones.find((z) => z.name === "Couch Zone")!.points).toEqual([
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 600 },
      ]);
    });

    it("keeps changes made to a zone", async () => {
      const { root, changeMount } = await setup();
      await draw(root, "0,0;500,0;500,300");
      await changeMount(moved);
      expect(drawn(root)).toBe("0,0;500,0;500,300");
    });

    it("marks zones as unsaved, since the device keeps them relative to the radar", async () => {
      const { root, card, options, changeMount } = await setup();
      expect(options()).toEqual(["Couch Zone", "Desk Zone", "Floor plan"]);
      await changeMount(moved);
      // The empty zone has nothing to move
      expect(options()).toEqual(["Couch Zone (unsaved)", "Desk Zone", "Floor plan"]);
      expect(root.querySelector(".dirty")!.textContent).toContain("Unsaved changes");

      // Saving writes where the zone is on the map, from the radar's new position
      [...root.querySelectorAll<HTMLButtonElement>(".edit-toolbar button")]
        .find((b) => b.textContent!.includes("Save"))!
        .click();
      expect(calls).toContainEqual({ type: "text.set_value", value: "-1000,0;0,0;0,600", entity_id: "text.couch" });

      // The device publishes it back, and the zone is saved
      const states = {
        ...card.hass!.states,
        "text.couch": { ...card.hass!.states["text.couch"], state: "-1000,0;0,0;0,600" },
      };
      card.hass = { ...card.hass!, states };
      await card.updateComplete;
      expect(root.querySelectorAll("select")[1].options[0].textContent).toBe("Couch Zone");
      expect(root.querySelector(".saved")!.textContent).toContain("Saved");
      expect(drawn(root)).toBe("0,0;1000,0;1000,600");
    });

    it("marks the floor plan as unsaved while it has changes", async () => {
      const { root, card, options } = await setup();
      const select = root.querySelectorAll("select")[1];
      select.value = "floor-plan";
      select.dispatchEvent(new Event("change"));
      await card.updateComplete;
      await draw(root, "0,0;100,0;100,100");
      expect(options()).toEqual(["Couch Zone", "Desk Zone", "Floor plan (unsaved)"]);
    });

    it("explains it", async () => {
      const { root } = await setup();
      expect(root.querySelector("details.radar .help")!.textContent).toContain("zones and the floor plan stay");
    });
  });

  it("lays out targets, edit, grid and entities", async () => {
    const root = await renderCard({}, hass());
    const sections = [...root.querySelectorAll(".card-content > section, .card-content > details")].map((el) =>
      el.tagName === "SECTION" ? el.className : el.querySelector("summary")!.textContent!.trim(),
    );
    expect(sections).toEqual(["targets", "Edit", "Radar Position", "Entities"]);
    // The targets go straight under the map, without a heading
    expect(root.querySelector(".targets h3")).toBeNull();
    expect((root.querySelector("details.edit") as HTMLDetailsElement).open).toBe(true);
    expect((root.querySelector("details.radar") as HTMLDetailsElement).open).toBe(false);
    const map = root.querySelector("ld2450-zone-map")! as unknown as HTMLElement & { updateComplete: Promise<unknown> };
    await map.updateComplete;
    expect(
      [...map.shadowRoot!.querySelectorAll(".legend > *")].map((el) => el.textContent!.replace(/\s+/g, " ").trim()),
    ).toEqual(["Tracking range", "Floor plan", "Selected zone", "Occupied", "Targets"]);
  });

  it("shows the snap step only while snapping to the grid", async () => {
    const root = await renderCard({}, hass());
    expect(root.querySelector(".snap-step")).not.toBeNull();
    const snap = root.querySelector<HTMLInputElement>("details.edit .snap-row label.check input")!;
    snap.checked = false;
    snap.dispatchEvent(new Event("change"));
    await (root.host as Ld2450ZoneCard).updateComplete;
    expect(root.querySelector(".snap-step")).toBeNull();
  });

  it("snaps to nearby points unless turned off, per user", async () => {
    const root = await renderCard({}, hass());
    const map = root.querySelector("ld2450-zone-map") as unknown as { snapToPoints: boolean };
    expect(map.snapToPoints).toBe(true);
    const box = root.querySelector<HTMLInputElement>(".snap-points input")!;
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    await (root.host as Ld2450ZoneCard).updateComplete;
    expect(map.snapToPoints).toBe(false);
    expect(calls).toContainEqual({
      type: "frontend/set_user_data",
      key: "ld2450_zone_card",
      value: { snapToPoints: false },
    });
  });

  describe("map toggles", () => {
    async function withOverlays(overlays: Record<string, boolean>) {
      const h = hass();
      const callWS = h.callWS;
      h.callWS = <T>(msg: { type: string; [key: string]: unknown }) =>
        msg.type === "frontend/get_user_data" ? Promise.resolve({ value: { overlays } } as T) : callWS<T>(msg);
      const root = await renderCard({}, h);
      const map = root.querySelector("ld2450-zone-map")! as unknown as HTMLElement & {
        updateComplete: Promise<unknown>;
      };
      await map.updateComplete;
      return { root, shadow: map.shadowRoot! };
    }

    it("hides targets", async () => {
      expect((await withOverlays({})).shadow.querySelectorAll("g.target")).toHaveLength(1);
      expect((await withOverlays({ targets: false })).shadow.querySelectorAll("g.target")).toHaveLength(0);
    });

    it("stops filling occupied zones", async () => {
      expect((await withOverlays({})).shadow.querySelector(".zone.occupied")).not.toBeNull();
      expect((await withOverlays({ occupied: false })).shadow.querySelector(".zone.occupied")).toBeNull();
    });

    it("hides the selected zone, and doesn't edit it out of sight", async () => {
      const shown = await withOverlays({});
      expect(shown.shadow.querySelectorAll("g.vertex").length).toBeGreaterThan(0);
      expect(shown.root.querySelector(".hidden-zone")).toBeNull();
      const hidden = await withOverlays({ selectedZone: false });
      expect(hidden.shadow.querySelectorAll("g.vertex")).toHaveLength(0);
      expect(hidden.shadow.querySelector(".zone.selected")).toBeNull();
      expect(hidden.root.querySelector(".hidden-zone")!.textContent).toContain("hidden on the map");
    });
  });

  it("rejects invalid config", () => {
    const card = document.createElement("ld2450-zone-card") as Ld2450ZoneCard;
    const set = (config: Record<string, unknown>) =>
      card.setConfig({ type: "custom:ld2450-zone-card", ...config } as Parameters<Ld2450ZoneCard["setConfig"]>[0]);
    expect(() => set({ targets: "sensor.x" })).toThrow(/list/);
    expect(() => set({ targets: [{ xy: 3 }] })).toThrow(/"xy"/);
    // The x and y sensors of earlier versions are replaced by the xy text sensor
    expect(() => set({ targets: [{ x: "sensor.x", y: "sensor.y" }] })).toThrow(/"xy" text sensor now/);
    expect(() => set({ zones: ["text.couch"] })).toThrow(/mapping/);
  });

  it("ignores config items the visual editor is still filling in", async () => {
    const root = await renderCard({ targets: [{ xy: "" }], zones: [{ polygon: "" }], device_id: "" }, hass());
    // Auto-detection still finds everything, as if the incomplete items weren't there
    expect(root.querySelector(".targets")!.textContent).toContain("Target 1");
    expect([...root.querySelectorAll("select")[0].options].map((o) => o.textContent)).toEqual(["Office"]);
  });

  it("has a visual editor for every option", () => {
    const form = (Ld2450ZoneCard as unknown as { getConfigForm(): { schema: { name: string }[] } }).getConfigForm();
    expect(form.schema.map((f) => f.name)).toEqual(["title", "device_id", "targets", "zones"]);
  });
});
