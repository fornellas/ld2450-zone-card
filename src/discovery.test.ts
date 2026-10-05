import { describe, expect, it } from "vitest";
import { discover, stripAxis } from "./discovery";
import type { HomeAssistant } from "./ha-types";
import { POLYGON_PATTERN } from "./polygon";

interface MockEntity {
  id: string;
  state?: string;
  device?: string | null;
  platform?: string;
  attributes?: Record<string, unknown>;
}

function mockHass(devices: Record<string, string>, entities: MockEntity[]): HomeAssistant {
  const hass: HomeAssistant = {
    states: {},
    entities: {},
    devices: {},
    config: { unit_system: { length: "km" } },
    connection: { subscribeMessage: () => Promise.reject(new Error()) },
    callService: () => Promise.resolve(),
    callWS: () => Promise.reject(new Error()),
  };
  for (const [id, name] of Object.entries(devices)) {
    hass.devices[id] = { id, name, name_by_user: null };
  }
  for (const e of entities) {
    hass.states[e.id] = {
      entity_id: e.id,
      state: e.state ?? "",
      attributes: e.attributes ?? {},
      last_changed: "",
      last_updated: "",
    };
    hass.entities[e.id] = {
      entity_id: e.id,
      device_id: e.device ?? null,
      platform: e.platform ?? "esphome",
    };
  }
  return hass;
}

const zone = (id: string, name: string, device = "dev1"): MockEntity => ({
  id,
  device,
  attributes: {
    friendly_name: name,
    min: 0,
    max: 255,
    pattern: POLYGON_PATTERN,
    mode: "text",
  },
});

const axis = (id: string, name: string, a: "x" | "y", device = "dev1"): MockEntity => ({
  id,
  device,
  state: "100",
  attributes: {
    friendly_name: name,
    unit_of_measurement: "mm",
    device_class: "distance",
    icon: `mdi:alpha-${a}-box-outline`,
  },
});

const presence = (id: string, name: string, device = "dev1"): MockEntity => ({
  id,
  device,
  state: "off",
  attributes: { friendly_name: name, device_class: "occupancy" },
});

function livingRoom(): MockEntity[] {
  return [
    zone("text.lr_couch", "Living Room Couch Zone Polygon"),
    zone("text.lr_desk", "Living Room Desk Zone Polygon"),
    presence("binary_sensor.lr_couch", "Living Room Couch Occupied"),
    presence("binary_sensor.lr_desk", "Living Room Desk Occupied"),
    // has_target: occupancy with an icon, so it is not a zone presence candidate
    {
      id: "binary_sensor.lr_presence",
      device: "dev1",
      attributes: {
        friendly_name: "Living Room Presence",
        device_class: "occupancy",
        icon: "mdi:shield-account",
      },
    },
    axis("sensor.lr_t2_x", "Living Room Target-2 X", "x"),
    axis("sensor.lr_t1_x", "Living Room Target-1 X", "x"),
    axis("sensor.lr_t1_y", "Living Room Target-1 Y", "y"),
    axis("sensor.lr_t2_y", "Living Room Target-2 Y", "y"),
    // Target distance: same unit and device class, different icon
    {
      id: "sensor.lr_t1_distance",
      device: "dev1",
      attributes: {
        friendly_name: "Living Room Target-1 Distance",
        unit_of_measurement: "mm",
        device_class: "distance",
        icon: "mdi:map-marker-distance",
      },
    },
  ];
}

describe("stripAxis", () => {
  it.each([
    ["Target-1 X", "x", "Target-1"],
    ["target_1_y", "y", "target_1"],
    ["X of Target 2", "x", "of Target 2"],
    ["Box Target", "x", undefined],
    ["Target 1 Y", "x", undefined],
  ] as const)("%s without %s is %s", (name, a, expected) => {
    expect(stripAxis(name, a)).toBe(expected);
  });
});

describe("discover", () => {
  it("finds zones, presence sensors and targets of a device", () => {
    const hass = mockHass({ dev1: "Living Room" }, livingRoom());
    expect(discover(hass)).toEqual([
      {
        id: "dev1",
        name: "Living Room",
        zones: [
          {
            polygon: "text.lr_couch",
            name: "Couch Zone Polygon",
            presence: "binary_sensor.lr_couch",
          },
          {
            polygon: "text.lr_desk",
            name: "Desk Zone Polygon",
            presence: "binary_sensor.lr_desk",
          },
        ],
        targets: [
          { x: "sensor.lr_t1_x", y: "sensor.lr_t1_y", name: "Target-1" },
          { x: "sensor.lr_t2_x", y: "sensor.lr_t2_y", name: "Target-2" },
        ],
        warnings: [],
      },
    ]);
  });

  it("finds nothing without polygon zones", () => {
    const hass = mockHass({ dev1: "Living Room" }, livingRoom().slice(2));
    expect(discover(hass)).toEqual([]);
  });

  it("ignores text entities that are not polygon zones", () => {
    const hass = mockHass({ dev1: "Office" }, [
      {
        id: "text.other",
        device: "dev1",
        attributes: { min: 0, max: 255, pattern: ".*" },
      },
      { ...zone("text.not_esphome", "Zone"), platform: "template" },
      {
        ...zone("text.wrong_max", "Zone"),
        attributes: { min: 0, max: 100, pattern: POLYGON_PATTERN },
      },
    ]);
    expect(discover(hass)).toEqual([]);
  });

  it("separates devices", () => {
    const hass = mockHass({ dev1: "Office", dev2: "Bedroom" }, [
      zone("text.office", "Office Desk Zone"),
      zone("text.bedroom", "Bedroom Bed Zone", "dev2"),
    ]);
    const devices = discover(hass);
    expect(devices.map((d) => [d.name, d.zones.map((z) => z.polygon)])).toEqual([
      ["Bedroom", ["text.bedroom"]],
      ["Office", ["text.office"]],
    ]);
  });

  it("limits to the configured device", () => {
    const hass = mockHass({ dev1: "Office", dev2: "Bedroom" }, [
      zone("text.office", "Office Desk Zone"),
      zone("text.bedroom", "Bedroom Bed Zone", "dev2"),
    ]);
    expect(discover(hass, { device_id: "dev1" }).map((d) => d.id)).toEqual(["dev1"]);
  });

  it("leaves ambiguous presence sensors unpaired", () => {
    const hass = mockHass({ dev1: "Office" }, [
      zone("text.a", "Office Desk Zone"),
      zone("text.b", "Office Desk Left Zone"),
      presence("binary_sensor.desk", "Office Desk Occupied"),
    ]);
    const [device] = discover(hass);
    expect(device.zones.map((z) => z.presence)).toEqual([undefined, undefined]);
  });

  it("uses overrides for presence and targets", () => {
    const hass = mockHass({ dev1: "Living Room" }, [
      ...livingRoom(),
      {
        id: "sensor.custom_x",
        device: null,
        attributes: { friendly_name: "Custom X" },
      },
      {
        id: "sensor.custom_y",
        device: null,
        attributes: { friendly_name: "Custom Y" },
      },
    ]);
    const [device] = discover(hass, {
      targets: [{ x: "sensor.custom_x", y: "sensor.custom_y" }],
      zones: [{ polygon: "text.lr_couch", presence: "binary_sensor.lr_presence" }],
    });
    expect(device.targets).toEqual([{ x: "sensor.custom_x", y: "sensor.custom_y", name: "Custom X" }]);
    expect(device.zones[0].presence).toBe("binary_sensor.lr_presence");
  });

  it("names devices and entities with the entity ID format", () => {
    const hass = mockHass({ dev1: "Radar" }, [
      zone("text.couch", "Radar Couch Zone"),
      axis("sensor.t1_x", "Radar Target 1 X", "x"),
      axis("sensor.t1_y", "Radar Target 1 Y", "y"),
    ]);
    const parts: Record<string, string> = { floor: "Ground", area: "Living Room", device: "Radar" };
    hass.formatEntityName = (stateObj, items, options) =>
      items
        .map((item) => (item.type === "entity" ? String(stateObj.attributes.friendly_name).slice(6) : parts[item.type]))
        .filter((n) => n !== undefined)
        .join(options?.separator ?? " ");
    const [device] = discover(hass, {}, ["floor", "area", "parent_device", "device", "entity"]);
    expect(device.name).toBe("Ground Living Room Radar");
    expect(device.zones[0].name).toBe("Couch Zone");
    expect(device.targets[0].name).toBe("Target 1");
  });

  it("warns about unpaired target sensors", () => {
    const hass = mockHass({ dev1: "Office" }, [
      zone("text.a", "Office Desk Zone"),
      axis("sensor.t1_x", "Office Target 1 X", "x"),
      axis("sensor.t1_y", "Office Target 1 Y", "y"),
      axis("sensor.t2_x", "Office Target 2 X", "x"),
    ]);
    const [device] = discover(hass);
    expect(device.targets).toHaveLength(1);
    expect(device.warnings).toEqual([expect.stringContaining("sensor.t2_x")]);
  });
});
