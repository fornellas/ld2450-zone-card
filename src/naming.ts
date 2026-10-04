// Names that follow the user's "Entity ID format" setting (Settings → System, HA 2026.8+).

import type { EntityNameType, HomeAssistant } from "./ha-types";

/** HA's default entity ID format, used when the setting is unset or unavailable. */
export const DEFAULT_ENTITY_ID_PARTS: EntityNameType[] = ["area", "parent_device", "device", "entity"];

/** The parts that name a device: the entity ID format without the entity itself. */
export function deviceNameParts(entityIdParts: EntityNameType[]): EntityNameType[] {
  return entityIdParts.filter((part) => part !== "entity");
}

let entityIdParts: Promise<EntityNameType[]> | undefined;

/** Read the entity ID format once per page load. Older HA versions don't have it and get the default. */
export function fetchEntityIdParts(hass: HomeAssistant): Promise<EntityNameType[]> {
  entityIdParts ??= hass
    .callWS<{ entity_id_parts: EntityNameType[] | null }>({ type: "config/entity_registry/settings/get" })
    .then((settings) => settings.entity_id_parts ?? DEFAULT_ENTITY_ID_PARTS)
    .catch(() => DEFAULT_ENTITY_ID_PARTS);
  return entityIdParts;
}
