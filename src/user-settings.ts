// Per-user card settings, stored by HA with the user's frontend data.

import type { HomeAssistant } from "./ha-types";
import type { Units } from "./units";

const KEY = "ld2450_zone_card";

export type Overlay = "trackingRange" | "pointLimits" | "floorPlan";

export interface UserSettings {
  units?: Units;
  /** Snap edited points to the grid. */
  snap?: boolean;
  /** Which helper outlines the map shows. All are shown until turned off. */
  overlays?: Partial<Record<Overlay, boolean>>;
  /** Margin around the trail when fitting a zone to it, for each unit system, in mm. */
  trailMargin?: Partial<Record<Units, number>>;
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
