// Per-user card settings, stored by HA with the user's frontend data.

import type { HomeAssistant } from "./ha-types";
import type { Units } from "./units";

const KEY = "ld2450_zone_card";

export type Overlay = "trackingRange" | "pointLimits" | "floorPlan" | "trail";

/** Whether an overlay is shown. The outlines are shown until turned off; the trail is off until turned on. */
export function overlayShown(overlays: Partial<Record<Overlay, boolean>> | undefined, overlay: Overlay): boolean {
  return overlays?.[overlay] ?? overlay !== "trail";
}

export interface UserSettings {
  units?: Units;
  /** Snap edited points to the grid. */
  snap?: boolean;
  /** Which helper outlines the map shows. All are shown until turned off. */
  overlays?: Partial<Record<Overlay, boolean>>;
  /** Snap step for each unit system, in mm. */
  snapStep?: Partial<Record<Units, number>>;
}

export async function fetchUserSettings(hass: HomeAssistant): Promise<UserSettings> {
  try {
    const { value } = await hass.callWS<{ value: UserSettings | null }>({ type: "frontend/get_user_data", key: KEY });
    return value ?? {};
  } catch {
    return {};
  }
}

export async function saveUserSettings(hass: HomeAssistant, settings: UserSettings): Promise<void> {
  await hass.callWS({ type: "frontend/set_user_data", key: KEY, value: settings });
}
