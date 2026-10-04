// Find LD2450 devices, their polygon zones, presence sensors and target sensors. See FIND.md.

import type { EntityNameType, HassEntity, HomeAssistant } from "./ha-types";
import { DEFAULT_ENTITY_ID_PARTS, deviceNameParts } from "./naming";
import { POLYGON_MAX, POLYGON_MIN, isPolygonPattern } from "./polygon";

export const MAX_TARGETS = 3;

export interface TargetSensors {
  x: string;
  y: string;
  /** Name shared by the X and Y sensors, e.g. "Target-1". */
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
  targets?: { x: string; y: string }[];
  zones?: { polygon: string; presence?: string }[];
}

const X_ICON = "mdi:alpha-x-box-outline";
const Y_ICON = "mdi:alpha-y-box-outline";

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

/** Remove the last standalone "x"/"y" word from a name: "Target-1 X" -> "Target-1". Undefined if there is none. */
export function stripAxis(name: string, axis: "x" | "y"): string | undefined {
  const re = new RegExp(`(^|[\\s_-])${axis}(?=$|[\\s_-])`, "gi");
  let last: RegExpExecArray | undefined;
  for (let m = re.exec(name); m !== null; m = re.exec(name)) last = m;
  if (last === undefined) return undefined;
  const start = last.index + last[1].length;
  return (name.slice(0, start) + name.slice(start + 1))
    .replace(/[\s_-]+$/, "")
    .replace(/^[\s_-]+/, "")
    .replace(/\s+/g, " ");
}

function firstNumber(text: string): number {
  const m = /\d+/.exec(text);
  return m ? Number(m[0]) : Number.POSITIVE_INFINITY;
}

function findTargets(hass: HomeAssistant, entityIds: string[], devName: string, warnings: string[]): TargetSensors[] {
  const candidates = (icon: string) =>
    entityIds.filter((id) => {
      const s = hass.states[id];
      return (
        id.startsWith("sensor.") &&
        s !== undefined &&
        s.attributes.unit_of_measurement === "mm" &&
        s.attributes.device_class === "distance" &&
        s.attributes.icon === icon
      );
    });

  const ys = new Map<string, string>();
  for (const id of candidates(Y_ICON)) {
    const key = stripAxis(friendlyName(hass, id), "y")?.toLowerCase();
    if (key !== undefined && !ys.has(key)) ys.set(key, id);
  }
  const targets: TargetSensors[] = [];
  const unpaired: string[] = [];
  for (const id of candidates(X_ICON)) {
    const key = stripAxis(friendlyName(hass, id), "x")?.toLowerCase();
    const y = key === undefined ? undefined : ys.get(key);
    if (key === undefined || y === undefined) {
      unpaired.push(id);
      continue;
    }
    ys.delete(key);
    targets.push({
      x: id,
      y,
      name: stripAxis(entityName(hass, id, devName), "x") ?? key,
    });
  }
  unpaired.push(...ys.values());
  if (unpaired.length > 0) {
    warnings.push(`Target sensors without an X/Y pair: ${unpaired.join(", ")}. Set "targets" in the card config.`);
  }
  if (targets.length > MAX_TARGETS) {
    warnings.push(`Found ${targets.length} target X/Y pairs, but the LD2450 has ${MAX_TARGETS}. Set "targets".`);
  }
  targets.sort((a, b) => firstNumber(a.name) - firstNumber(b.name) || a.name.localeCompare(b.name));
  return targets;
}

function pairPresence(hass: HomeAssistant, zones: Zone[], entityIds: string[], devName: string): void {
  const candidates = entityIds.filter((id) => {
    const s = hass.states[id];
    return (
      id.startsWith("binary_sensor.") &&
      s !== undefined &&
      s.attributes.device_class === "occupancy" &&
      s.attributes.icon === undefined
    );
  });
  const devWords = new Set(words(devName));
  const keyWords = (id: string) =>
    new Set(words(friendlyName(hass, id)).filter((w) => !devWords.has(w) && !ZONE_NAME_STOPWORDS.has(w)));
  const candidateWords = candidates.map((id) => ({ id, words: keyWords(id) }));

  const used = new Map<string, Zone[]>();
  for (const zone of zones) {
    if (zone.presence !== undefined) continue;
    const zoneWords = keyWords(zone.polygon);
    const matches = candidateWords.filter((c) => [...zoneWords].some((w) => c.words.has(w)));
    if (matches.length !== 1) continue;
    zone.presence = matches[0].id;
    used.set(zone.presence, [...(used.get(zone.presence) ?? []), zone]);
  }
  // A sensor matching several zones is ambiguous
  for (const shared of used.values()) {
    if (shared.length > 1) for (const zone of shared) zone.presence = undefined;
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
      const targetDevice = deviceOf(t.x);
      return targetDevice === id || (targetDevice === undefined && single);
    });
    const targets =
      overridden.length > 0
        ? overridden.map((t) => ({ ...t, name: entityName(hass, t.x, name) }))
        : findTargets(hass, entityIds, name, warnings);
    if (targets.length === 0) warnings.push('No target X/Y sensors found. Set "targets" in the card config.');

    devices.push({ id, name: deviceLabel(hass, id, polygonIds[0], entityIdParts), zones, targets, warnings });
  }
  devices.sort((a, b) => a.name.localeCompare(b.name));
  return devices;
}
