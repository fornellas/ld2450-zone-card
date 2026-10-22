// Find LD2450 devices, their polygon zones, presence sensors and target sensors. See FIND.md.

import type { EntityNameType, HassEntity, HomeAssistant } from "./ha-types";
import { DEFAULT_ENTITY_ID_PARTS, deviceNameParts } from "./naming";
import { POLYGON_MAX, POLYGON_MIN, isPolygonPattern } from "./polygon";
import { isXYState } from "./targets";

export const MAX_TARGETS = 3;

export interface TargetSensors {
  /** The target's "xy" text sensor. */
  xy: string;
  /** The sensor's name without "XY", e.g. "Target-1". */
  name: string;
}

export interface Zone {
  /** The text entity holding the polygon. */
  polygon: string;
  name: string;
  presence?: string;
}

export interface Ld2450Device {
  id: string;
  /** Fully qualified name, following the entity ID format setting, e.g. "Living Room Radar". */
  name: string;
  zones: Zone[];
  targets: TargetSensors[];
  /** Problems the user may fix with the card config. */
  warnings: string[];
}

/** Card config keys that override auto-detection. */
export interface DiscoveryOverrides {
  device_id?: string;
  targets?: { xy: string }[];
  zones?: { polygon: string; presence?: string }[];
}

// The default icon of the ld2450 "xy" text sensor
const XY_ICON = "mdi:crosshairs-gps";

// Words that name the kind of entity rather than the zone, e.g. "Couch Zone Polygon" vs "Couch Occupied"
const ZONE_NAME_STOPWORDS = new Set([
  "zone",
  "zones",
  "polygon",
  "occupied",
  "occupancy",
  "presence",
  "present",
  "area",
  "sensor",
  "the",
  "in",
]);

export function isPolygonZone(hass: HomeAssistant, stateObj: HassEntity): boolean {
  if (!stateObj.entity_id.startsWith("text.")) return false;
  const { attributes } = stateObj;
  if (attributes.min !== POLYGON_MIN || attributes.max !== POLYGON_MAX) return false;
  if (!isPolygonPattern(attributes.pattern)) return false;
  const platform = hass.entities?.[stateObj.entity_id]?.platform;
  return platform === undefined || platform === "esphome";
}

function deviceName(hass: HomeAssistant, deviceId: string): string {
  const device = hass.devices?.[deviceId];
  return device?.name_by_user || device?.name || deviceId;
}

/** Name a device with the parts of the entity ID format, using one of its entities for context. */
function deviceLabel(
  hass: HomeAssistant,
  deviceId: string,
  entityId: string | undefined,
  entityIdParts: EntityNameType[],
): string {
  const stateObj = entityId === undefined ? undefined : hass.states[entityId];
  if (hass.formatEntityName !== undefined && stateObj !== undefined) {
    const parts = deviceNameParts(entityIdParts).map((type) => ({ type }));
    const label = hass.formatEntityName(stateObj, parts, { separator: " " }).trim();
    if (label !== "") return label;
  }
  return deviceName(hass, deviceId);
}

function friendlyName(hass: HomeAssistant, entityId: string): string {
  const name = hass.states[entityId]?.attributes.friendly_name;
  return typeof name === "string" && name !== "" ? name : entityId;
}

/** The entity's own name, as HA shows entity names in device context. */
function entityName(hass: HomeAssistant, entityId: string, devName: string): string {
  const stateObj = hass.states[entityId];
  if (hass.formatEntityName !== undefined && stateObj !== undefined) {
    const name = hass.formatEntityName(stateObj, [{ type: "entity" }]).trim();
    if (name !== "") return name;
  }
  // Older HA: strip the device name from the friendly name
  const name = friendlyName(hass, entityId);
  if (name.toLowerCase().startsWith(devName.toLowerCase() + " ")) {
    const stripped = name.slice(devName.length + 1).trim();
    if (stripped !== "") return stripped;
  }
  return name;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "");
}

/** Remove the last standalone word from a name: "Target-1 XY" -> "Target-1". Undefined if there is none. */
export function stripWord(name: string, word: string): string | undefined {
  const re = new RegExp(`(^|[\\s_-])${word}(?=$|[\\s_-])`, "gi");
  let last: RegExpExecArray | undefined;
  for (let m = re.exec(name); m !== null; m = re.exec(name)) last = m;
  if (last === undefined) return undefined;
  const start = last.index + last[1].length;
  return (name.slice(0, start) + name.slice(start + word.length))
    .replace(/[\s_-]+$/, "")
    .replace(/^[\s_-]+/, "")
    .replace(/\s+/g, " ");
}

function firstNumber(text: string): number {
  const m = /\d+/.exec(text);
  return m ? Number(m[0]) : Number.POSITIVE_INFINITY;
}

/**
 * The ld2450 "xy" text sensors of a device: Home Assistant shows ESPHome text sensors as `sensor` entities, with the
 * sensor's icon (mdi:crosshairs-gps by default) and, as state, "x,y" in mm or "NA". The icon is a default users can
 * change; the state is always one of those, and tells these from other text sensors that have a position's icon.
 * Targets are numbered by the number in their names ("Target-1 XY"), or by their order.
 */
function findTargets(hass: HomeAssistant, entityIds: string[], devName: string, warnings: string[]): TargetSensors[] {
  const targets = entityIds
    .filter((id) => {
      const s = hass.states[id];
      return id.startsWith("sensor.") && s !== undefined && s.attributes.icon === XY_ICON && isXYState(s.state);
    })
    .map((xy) => targetSensors(hass, xy, devName));
  if (targets.length > MAX_TARGETS) {
    warnings.push(`Found ${targets.length} target XY sensors, but the LD2450 has ${MAX_TARGETS}. Set "targets".`);
  }
  targets.sort((a, b) => firstNumber(a.name) - firstNumber(b.name) || a.name.localeCompare(b.name));
  return targets;
}

function targetSensors(hass: HomeAssistant, xy: string, devName: string): TargetSensors {
  const name = entityName(hass, xy, devName);
  return { xy, name: stripWord(name, "xy") ?? name };
}

// Scores of a zone-sensor pair: sharing all their words beats sharing any number of them
const EXACT_MATCH = 1000;

/**
 * Pair zones with their presence sensors by name, after removing the device name and words like "zone" or
 * "occupied": "Couch Left" pairs with "Couch Left Occupied". Every zone-sensor pair is scored, exact matches of the
 * remaining words highest, then by how many words they share, and pairs are made one-to-one, best score first. A
 * zone whose best score ties between sensors, or that ties with another zone for a sensor, stays unpaired, for the
 * user to set in the card config.
 */
function pairPresence(hass: HomeAssistant, zones: Zone[], entityIds: string[], devName: string): void {
  const taken = new Set(zones.map((z) => z.presence).filter((p) => p !== undefined));
  const candidates = entityIds.filter((id) => {
    const s = hass.states[id];
    return (
      id.startsWith("binary_sensor.") &&
      !taken.has(id) &&
      s !== undefined &&
      s.attributes.device_class === "occupancy" &&
      s.attributes.icon === undefined
    );
  });
  const devWords = new Set(words(devName));
  const keyWords = (id: string) =>
    new Set(words(friendlyName(hass, id)).filter((w) => !devWords.has(w) && !ZONE_NAME_STOPWORDS.has(w)));
  const sensorWords = candidates.map((id) => ({ id, words: keyWords(id) }));

  const pairs: { zone: Zone; sensor: string; score: number }[] = [];
  for (const zone of zones) {
    if (zone.presence !== undefined) continue;
    const zoneWords = keyWords(zone.polygon);
    for (const sensor of sensorWords) {
      const shared = [...zoneWords].filter((w) => sensor.words.has(w)).length;
      if (shared === 0) continue;
      const exact = shared === zoneWords.size && shared === sensor.words.size;
      pairs.push({ zone, sensor: sensor.id, score: exact ? EXACT_MATCH + shared : shared });
    }
  }

  const settled = new Set<Zone>();
  const used = new Set<string>();
  for (const score of [...new Set(pairs.map((p) => p.score))].sort((a, b) => b - a)) {
    const open = () => pairs.filter((p) => p.score === score && !settled.has(p.zone) && !used.has(p.sensor));
    // A zone with several sensors at its best score is ambiguous
    for (const zone of new Set(open().map((p) => p.zone))) {
      if (open().filter((p) => p.zone === zone).length > 1) settled.add(zone);
    }
    for (const sensor of new Set(open().map((p) => p.sensor))) {
      const contenders = open().filter((p) => p.sensor === sensor);
      // So is a sensor that several zones match equally well
      for (const p of contenders) settled.add(p.zone);
      if (contenders.length === 1) {
        contenders[0].zone.presence = sensor;
        used.add(sensor);
      }
    }
  }
}

/** Find all LD2450 devices with polygon zones. Config overrides always win over auto-detection. */
export function discover(
  hass: HomeAssistant,
  overrides: DiscoveryOverrides = {},
  entityIdParts: EntityNameType[] = DEFAULT_ENTITY_ID_PARTS,
): Ld2450Device[] {
  const deviceOf = (entityId: string) => hass.entities?.[entityId]?.device_id ?? undefined;

  const zoneIds = new Set(
    Object.values(hass.states)
      .filter((s) => isPolygonZone(hass, s))
      .map((s) => s.entity_id),
  );
  for (const z of overrides.zones ?? []) zoneIds.add(z.polygon);

  const zonesByDevice = new Map<string, string[]>();
  for (const id of zoneIds) {
    const deviceId = deviceOf(id) ?? overrides.device_id;
    if (deviceId === undefined) continue;
    if (overrides.device_id !== undefined && deviceId !== overrides.device_id) continue;
    zonesByDevice.set(deviceId, [...(zonesByDevice.get(deviceId) ?? []), id]);
  }
  if (overrides.device_id !== undefined && !zonesByDevice.has(overrides.device_id)) {
    zonesByDevice.set(overrides.device_id, []);
  }

  const entitiesByDevice = new Map<string, string[]>();
  for (const entry of Object.values(hass.entities ?? {})) {
    if (!entry.device_id) continue;
    entitiesByDevice.set(entry.device_id, [...(entitiesByDevice.get(entry.device_id) ?? []), entry.entity_id]);
  }

  const presenceOverrides = new Map((overrides.zones ?? []).map((z) => [z.polygon, z.presence]));
  const single = zonesByDevice.size === 1;

  const devices: Ld2450Device[] = [];
  for (const [id, polygonIds] of zonesByDevice) {
    const name = deviceName(hass, id);
    const entityIds = entitiesByDevice.get(id) ?? [];
    const warnings: string[] = [];

    const zones: Zone[] = polygonIds.map((polygon) => ({
      polygon,
      name: entityName(hass, polygon, name),
      presence: presenceOverrides.get(polygon),
    }));
    zones.sort((a, b) => a.name.localeCompare(b.name));
    pairPresence(hass, zones, entityIds, name);
    if (zones.length === 0) warnings.push("This device has no polygon zones.");

    // Overridden targets belong to the device of their X sensor; ones without a device go to the only device
    const overridden = (overrides.targets ?? []).filter((t) => {
      const targetDevice = deviceOf(t.xy);
      return targetDevice === id || (targetDevice === undefined && single);
    });
    const targets =
      overridden.length > 0
        ? overridden.map((t) => targetSensors(hass, t.xy, name))
        : findTargets(hass, entityIds, name, warnings);
    if (targets.length === 0) {
      warnings.push('No target "xy" text sensors found. Add them in ESPHome, or set "targets" in the card config.');
    }

    devices.push({ id, name: deviceLabel(hass, id, polygonIds[0], entityIdParts), zones, targets, warnings });
  }
  devices.sort((a, b) => a.name.localeCompare(b.name));
  return devices;
}
