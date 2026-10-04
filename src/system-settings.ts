// Card settings shared by all users, stored by HA with the frontend system data (HA 2025.12+).
// Only admins can change them.

import type { HomeAssistant } from "./ha-types";
import type { Point } from "./polygon";
import { DEFAULT_MOUNT, type Mount } from "./transform";

const KEY = "ld2450_zone_card";

export interface SystemSettings {
  /** How each radar is mounted, by device ID. */
  mounts?: Record<string, Mount>;
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPoint = (v: unknown): v is Point =>
  typeof v === "object" && v !== null && isNumber((v as Point).x) && isNumber((v as Point).y);

/** The device's mount, or the default when it's missing or malformed. */
export function deviceMount(settings: SystemSettings | undefined, deviceId: string): Mount {
  const m = settings?.mounts?.[deviceId] as Partial<Mount> | undefined;
  if (m === undefined || typeof m.upsideDown !== "boolean" || !isNumber(m.rotation) || !isPoint(m.offset)) {
    return DEFAULT_MOUNT;
  }
  return { upsideDown: m.upsideDown, rotation: m.rotation, offset: { x: m.offset.x, y: m.offset.y } };
}

export function withDeviceMount(settings: SystemSettings, deviceId: string, mount: Mount): SystemSettings {
  return { ...settings, mounts: { ...settings.mounts, [deviceId]: mount } };
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
