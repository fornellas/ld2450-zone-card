import { describe, expect, it } from "vitest";
import { discover, stripWord } from "./discovery";
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

/** The ld2450 "xy" text sensor. HA shows ESPHome text sensors as `sensor` entities, with no unit or device class. */
const xy = (id: string, name: string, state = "NA", device = "dev1", icon = "mdi:crosshairs-gps"): MockEntity => ({
  id,
  device,
  state,
  attributes: { friendly_name: name, icon },
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
    xy("sensor.lr_t2_xy", "Living Room Target-2 XY"),
    xy("sensor.lr_t1_xy", "Living Room Target-1 XY", "-782,1713"),
    // The direction text sensor says "NA" without a target too, but has another icon
    {
      id: "sensor.lr_t1_direction",
      device: "dev1",
      state: "NA",
      attributes: { friendly_name: "Living Room Target-1 Direction", icon: "mdi:sign-direction" },
    },
    // The separate X sensor of a target isn't used
    {
      id: "sensor.lr_t1_x",
      device: "dev1",
      state: "-782",
      attributes: {
        friendly_name: "Living Room Target-1 X",
        unit_of_measurement: "mm",
        device_class: "distance",
        icon: "mdi:alpha-x-box-outline",
      },
    },
  ];
}

describe("stripWord", () => {
  it.each([
    ["Target-1 XY", "xy", "Target-1"],
    ["target_1_xy", "xy", "target_1"],
    ["XY of Target 2", "xy", "of Target 2"],
    ["Maxy Target", "xy", undefined],
    ["Target 1 X", "xy", undefined],
  ] as const)("%s without %s is %s", (name, word, expected) => {
    expect(stripWord(name, word)).toBe(expected);
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
          { xy: "sensor.lr_t1_xy", name: "Target-1" },
          { xy: "sensor.lr_t2_xy", name: "Target-2" },
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

  describe("pairing zones with presence sensors", () => {
    const presenceOf = (entities: MockEntity[]) =>
      Object.fromEntries(discover(mockHass({ dev1: "Office" }, entities))[0].zones.map((z) => [z.polygon, z.presence]));

    it('pairs "<zone name> Occupied"', () => {
      expect(
        presenceOf([
          zone("text.seat", "Office Window Seat"),
          presence("binary_sensor.seat", "Office Window Seat Occupied"),
        ]),
      ).toEqual({ "text.seat": "binary_sensor.seat" });
    });

    it("pairs zones that share words by their exact match", () => {
      expect(
        presenceOf([
          zone("text.left", "Office Couch Left"),
          zone("text.right", "Office Couch Right"),
          presence("binary_sensor.right", "Office Couch Right Occupied"),
          presence("binary_sensor.left", "Office Couch Left Occupied"),
        ]),
      ).toEqual({ "text.left": "binary_sensor.left", "text.right": "binary_sensor.right" });
    });

    it("pairs the exact match, and leaves a zone that only shares a word unpaired", () => {
      expect(
        presenceOf([
          zone("text.a", "Office Desk Zone"),
          zone("text.b", "Office Desk Left Zone"),
          presence("binary_sensor.desk", "Office Desk Occupied"),
        ]),
      ).toEqual({ "text.a": "binary_sensor.desk", "text.b": undefined });
    });

    it("prefers the sensor sharing more words", () => {
      expect(
        presenceOf([
          zone("text.a", "Office Big Desk Left"),
          presence("binary_sensor.one", "Office Desk Occupied"),
          presence("binary_sensor.two", "Office Desk Left Occupied"),
        ]),
      ).toEqual({ "text.a": "binary_sensor.two" });
    });

    it("leaves a zone unpaired when sensors tie for it", () => {
      expect(
        presenceOf([
          zone("text.desk", "Office Desk"),
          presence("binary_sensor.left", "Office Desk Left Occupied"),
          presence("binary_sensor.right", "Office Desk Right Occupied"),
        ]),
      ).toEqual({ "text.desk": undefined });
    });

    it("leaves zones unpaired when they tie for a sensor", () => {
      expect(
        presenceOf([
          zone("text.a", "Office Desk A"),
          zone("text.b", "Office Desk B"),
          presence("binary_sensor.desk", "Office Desk Occupied"),
        ]),
      ).toEqual({ "text.a": undefined, "text.b": undefined });
    });

    it("doesn't give a sensor set in the config to another zone", () => {
      const [device] = discover(
        mockHass({ dev1: "Office" }, [
          zone("text.a", "Office Couch"),
          zone("text.b", "Office Couch Left"),
          presence("binary_sensor.couch", "Office Couch Occupied"),
        ]),
        { zones: [{ polygon: "text.b", presence: "binary_sensor.couch" }] },
      );
      expect(device.zones.map((z) => [z.polygon, z.presence])).toEqual([
        ["text.a", undefined],
        ["text.b", "binary_sensor.couch"],
      ]);
    });
  });

  it("uses overrides for presence and targets", () => {
    const hass = mockHass({ dev1: "Living Room" }, [
      ...livingRoom(),
      { id: "sensor.custom_xy", device: null, attributes: { friendly_name: "Custom XY" } },
    ]);
    const [device] = discover(hass, {
      targets: [{ xy: "sensor.custom_xy" }],
      zones: [{ polygon: "text.lr_couch", presence: "binary_sensor.lr_presence" }],
    });
    expect(device.targets).toEqual([{ xy: "sensor.custom_xy", name: "Custom" }]);
    expect(device.zones[0].presence).toBe("binary_sensor.lr_presence");
  });

  it("names devices and entities with the entity ID format", () => {
    const hass = mockHass({ dev1: "Radar" }, [
      zone("text.couch", "Radar Couch Zone"),
      xy("sensor.t1_xy", "Radar Target 1 XY"),
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

  describe("target xy sensors", () => {
    const targetsOf = (entities: MockEntity[]) =>
      discover(mockHass({ dev1: "Office" }, [zone("text.a", "Office Desk Zone"), ...entities]))[0];

    it.each(["NA", "unknown", "unavailable", "-782,1713", "0,2000"])("finds one that says %s", (state) => {
      expect(targetsOf([xy("sensor.t1_xy", "Office Target 1 XY", state)]).targets).toEqual([
        { xy: "sensor.t1_xy", name: "Target 1" },
      ]);
    });

    it("ignores sensors with its icon that don't say a position", () => {
      expect(targetsOf([xy("sensor.other", "Office Compass", "North")]).targets).toEqual([]);
    });

    it("needs its default icon, which users can change", () => {
      const device = targetsOf([xy("sensor.t1_xy", "Office Target 1 XY", "-782,1713", "dev1", "mdi:target")]);
      expect(device.targets).toEqual([]);
      expect(device.warnings).toEqual([expect.stringContaining('"targets"')]);
    });

    it("ignores sensors of other devices", () => {
      expect(targetsOf([xy("sensor.t1_xy", "Other Target 1 XY", "NA", "dev2")]).targets).toEqual([]);
    });

    it("numbers targets by the number in their names, or by their names", () => {
      expect(
        targetsOf([xy("sensor.b", "Office Target 3 XY"), xy("sensor.a", "Office Target 1 XY")]).targets.map(
          (t) => t.xy,
        ),
      ).toEqual(["sensor.a", "sensor.b"]);
      expect(
        targetsOf([xy("sensor.b", "Office Beta XY"), xy("sensor.a", "Office Alpha XY")]).targets.map((t) => t.xy),
      ).toEqual(["sensor.a", "sensor.b"]);
    });

    it("keeps the name when it has no XY", () => {
      expect(targetsOf([xy("sensor.t1", "Office Target 1")]).targets).toEqual([{ xy: "sensor.t1", name: "Target 1" }]);
    });

    it("warns about more than three", () => {
      const device = targetsOf([1, 2, 3, 4].map((n) => xy(`sensor.t${n}_xy`, `Office Target ${n} XY`)));
      expect(device.targets).toHaveLength(4);
      expect(device.warnings).toEqual([expect.stringContaining("4 target XY sensors")]);
    });

    it("warns when there are none", () => {
      expect(targetsOf([]).warnings).toEqual([expect.stringContaining('No target "xy" text sensors')]);
    });
  });
});
