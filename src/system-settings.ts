// Card settings shared by all users, stored by HA with the frontend system data (HA 2025.12+).
// Only admins can change them.

import type { HomeAssistant } from "./ha-types";
import type { Point } from "./polygon";
import { DEFAULT_MOUNT, type Mount } from "./transform";

const KEY = "ld2450_zone_card";

export interface SystemSettings {
  /** How each radar is mounted, by device ID. */
  mounts?: Record<string, Mount>;
  /** The room's floor plan around each radar, in room coordinates (mm), by device ID. */
  floorPlans?: Record<string, Point[]>;
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPoint = (v: unknown): v is Point =>
  typeof v === "object" && v !== null && isNumber((v as Point).x) && isNumber((v as Point).y);

/** The device's mount, or the default when it's missing or malformed. */
export function deviceMount(settings: SystemSettings | undefined, deviceId: string): Mount {
  const m = settings?.mounts?.[deviceId] as (Partial<Mount> & { upsideDown?: unknown }) | undefined;
  if (m === undefined || !isNumber(m.rotation) || !isPoint(m.offset)) return DEFAULT_MOUNT;
  // v0.0.8 stored "upsideDown", which showed the radar's x as-is when set
  const invertX =
    typeof m.invertX === "boolean" ? m.invertX : typeof m.upsideDown === "boolean" ? !m.upsideDown : undefined;
  if (invertX === undefined) return DEFAULT_MOUNT;
  return { invertX, rotation: m.rotation, offset: { x: m.offset.x, y: m.offset.y } };
}

export function withDeviceMount(settings: SystemSettings, deviceId: string, mount: Mount): SystemSettings {
  return { ...settings, mounts: { ...settings.mounts, [deviceId]: mount } };
}

/** The device's floor plan, or none when it's missing or malformed. */
export function deviceFloorPlan(settings: SystemSettings | undefined, deviceId: string): Point[] {
  const plan: unknown = settings?.floorPlans?.[deviceId];
  if (!Array.isArray(plan) || !plan.every(isPoint)) return [];
  return plan.map((p) => ({ x: p.x, y: p.y }));
}

export function withFloorPlan(settings: SystemSettings, deviceId: string, plan: Point[]): SystemSettings {
  return { ...settings, floorPlans: { ...settings.floorPlans, [deviceId]: plan } };
}

/** Call back with the settings now and whenever they change. Resolves to the unsubscribe function. */
export function subscribeSystemSettings(
  hass: HomeAssistant,
  callback: (settings: SystemSettings) => void,
): Promise<() => void> {
  return hass.connection.subscribeMessage<{ value: SystemSettings | null }>((event) => callback(event.value ?? {}), {
    type: "frontend/subscribe_system_data",
    key: KEY,
  });
}

export async function saveSystemSettings(hass: HomeAssistant, settings: SystemSettings): Promise<void> {
  await hass.callWS({ type: "frontend/set_system_data", key: KEY, value: settings });
}
