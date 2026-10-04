// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import "./mount-editor";
import type { Ld2450MountEditor } from "./mount-editor";
import { DEFAULT_MOUNT, type Mount } from "./transform";

async function editor(units: "metric" | "imperial" = "metric") {
  const el = document.createElement("ld2450-mount-editor") as Ld2450MountEditor;
  el.mount = DEFAULT_MOUNT;
  el.units = units;
  document.body.appendChild(el);
  await el.updateComplete;
  const changes: Mount[] = [];
  el.addEventListener("mount-changed", (ev) => changes.push((ev as CustomEvent<Mount>).detail));
  return { el, changes, inputs: [...el.shadowRoot!.querySelectorAll("input")] };
}

function setValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("change"));
}

describe("ld2450-mount-editor", () => {
  it("toggles upside down", async () => {
    const { changes, inputs } = await editor();
    inputs[0].checked = true;
    inputs[0].dispatchEvent(new Event("change"));
    expect(changes).toEqual([{ ...DEFAULT_MOUNT, invertX: true }]);
  });

  it.each([
    ["90", 90],
    ["270", -90],
    ["-180", 180],
    ["540", 180],
    ["12.6", 13],
  ])("normalizes rotation %s to %d", async (value, rotation) => {
    const { changes, inputs } = await editor();
    setValue(inputs[1], value);
    expect(changes).toEqual([{ ...DEFAULT_MOUNT, rotation }]);
  });

  it("ignores an empty rotation", async () => {
    const { changes, inputs } = await editor();
    setValue(inputs[1], "");
    expect(changes).toEqual([]);
  });

  it("converts offsets from the input units", async () => {
    const metric = await editor("metric");
    setValue(metric.inputs[2], "1.25");
    expect(metric.changes).toEqual([{ ...DEFAULT_MOUNT, offset: { x: 1250, y: 0 } }]);

    const imperial = await editor("imperial");
    setValue(imperial.inputs[3], "10");
    expect(imperial.changes).toEqual([{ ...DEFAULT_MOUNT, offset: { x: 0, y: 3048 } }]);
  });

  it("updates while typing or scrolling, before the field loses focus", async () => {
    const { el, changes, inputs } = await editor();
    inputs[2].value = "1.50";
    inputs[2].dispatchEvent(new Event("input"));
    expect(changes).toEqual([{ ...DEFAULT_MOUNT, offset: { x: 1500, y: 0 } }]);
    // The parent applies the change; what the user typed stays as typed
    el.mount = changes[0];
    await el.updateComplete;
    expect(inputs[2].value).toBe("1.50");
    // Leaving the field shows the value in use
    inputs[2].dispatchEvent(new Event("change"));
    await el.updateComplete;
    expect(inputs[2].value).toBe("1.5");
  });

  it("waits for partial numbers to be complete", async () => {
    const { changes, inputs } = await editor();
    inputs[1].value = "";
    inputs[1].dispatchEvent(new Event("input"));
    expect(changes).toEqual([]);
  });

  it("disables inputs for non-admins", async () => {
    const { el } = await editor();
    el.disabled = true;
    await el.updateComplete;
    expect([...el.shadowRoot!.querySelectorAll("input")].every((i) => i.disabled)).toBe(true);
    expect(el.shadowRoot!.textContent).toContain("Only administrators");
  });
});
