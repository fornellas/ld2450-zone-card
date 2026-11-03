// Per-user card settings, stored by HA with the user's frontend data.

import type { HomeAssistant } from "./ha-types";
import type { Units } from "./units";

const KEY = "ld2450_zone_card";

export type Overlay = "trackingRange" | "floorPlan" | "selectedZone" | "occupied" | "targets";

export interface UserSettings {
  units?: Units;
  /** Snap edited points to the grid. */
  snap?: boolean;
  /** Snap edited points onto nearby points of the floor plan and other zones. */
  snapToPoints?: boolean;
  /** Which helper outlines the map shows. All are shown until turned off. */
  overlays?: Partial<Record<Overlay, boolean>>;
  /** Margin around the trail when fitting a zone to it, for each unit system, in mm. */
  trailMargin?: Partial<Record<Units, number>>;
  /** Snap step for each unit system, in mm. */
  snapStep?: Partial<Record<Units, number>>;
  /** The device and the zone (or floor plan) last selected. */
  deviceId?: string;
  zoneId?: string;
  /** Whether each collapsible section is open. */
  sections?: Partial<Record<Section, boolean>>;
}

export type Section = "edit" | "radar" | "entities";

export const DEFAULT_SECTIONS: Record<Section, boolean> = { edit: true, radar: false, entities: false };

export async function fetchUserSettings(hass: HomeAssistant): Promise<UserSettings> {
  try {
    const { value } = await hass.callWS<{ value: UserSettings | null }>({ type: "frontend/get_user_data", key: KEY });
    // Earlier versions had a "zone point limits" overlay; drop its toggle, so it goes with the next save
    const overlays = value?.overlays as Record<string, boolean> | undefined;
    if (overlays !== undefined && "pointLimits" in overlays) {
      const { pointLimits: _, ...rest } = overlays;
      return { ...value, overlays: rest };
    }
    return value ?? {};
  } catch {
    return {};
  }
}

export async function saveUserSettings(hass: HomeAssistant, settings: UserSettings): Promise<void> {
  await hass.callWS({ type: "frontend/set_user_data", key: KEY, value: settings });
}
