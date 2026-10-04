// Per-user card settings, stored by HA with the user's frontend data.

import type { HomeAssistant } from "./ha-types";
import type { Units } from "./units";

const KEY = "ld2450_zone_card";

export interface UserSettings {
  units?: Units;
  /** Snap edited points to the grid. */
  snap?: boolean;
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
