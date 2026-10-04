// The subset of Home Assistant frontend types the card uses.

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

/** An entry of hass.entities, the entity registry as the frontend sees it. */
export interface EntityRegistryDisplayEntry {
  entity_id: string;
  device_id?: string | null;
  platform?: string;
  entity_category?: string | null;
  name?: string | null;
  icon?: string | null;
  hidden?: boolean;
}

/** An entry of hass.devices. */
export interface DeviceRegistryEntry {
  id: string;
  name: string | null;
  name_by_user: string | null;
}

export type EntityNameType = "floor" | "area" | "parent_device" | "device" | "entity";

export type EntityNameItem = { type: EntityNameType } | { type: "text"; text: string };

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  entities: Record<string, EntityRegistryDisplayEntry>;
  devices: Record<string, DeviceRegistryEntry>;
  config: { unit_system: { length: string } };
  user?: { is_admin: boolean };
  connection: {
    subscribeMessage<T>(
      callback: (event: T) => void,
      msg: { type: string; [key: string]: unknown },
    ): Promise<() => void>;
  };
  callWS<T>(msg: { type: string; [key: string]: unknown }): Promise<T>;
  /** Name an entity from registry parts, like HA's own UI. HA 2026.4+. */
  formatEntityName?(stateObj: HassEntity, name: EntityNameItem[], options?: { separator?: string }): string;
}

export interface LovelaceCardConfig {
  type: string;
  [key: string]: unknown;
}

declare global {
  interface Window {
    customCards?: {
      type: string;
      name: string;
      description?: string;
      preview?: boolean;
      documentationURL?: string;
    }[];
  }
}
