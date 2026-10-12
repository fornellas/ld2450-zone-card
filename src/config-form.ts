// The card's visual editor: Home Assistant builds it from this form schema (HA 2024.11+).

import type { DiscoveryOverrides } from "./discovery";

interface FormField {
  name: string;
  selector: Record<string, unknown>;
}

const LABELS: Record<string, string> = {
  title: "Title",
  device_id: "Device",
  targets: "Target sensors",
  zones: "Zones",
};

const HELPERS: Record<string, string> = {
  device_id: "Only show this LD2450. Leave empty to choose any device from the card.",
  targets:
    "The X and Y sensors of each target. Leave empty to find them automatically, from their default icons and names.",
  zones:
    "Pair a zone with its presence sensor. Leave empty to pair them automatically, by name " +
    '(for example "Couch" and "Couch Occupied").',
};

const entity = (domain: string) => ({ entity: { filter: { domain } } });

export const CONFIG_FORM = {
  schema: [
    { name: "title", selector: { text: {} } },
    { name: "device_id", selector: { device: { filter: { integration: "esphome" } } } },
    {
      name: "targets",
      selector: {
        object: {
          multiple: true,
          label_field: "x",
          description_field: "y",
          fields: {
            x: { label: "X sensor", required: true, selector: entity("sensor") },
            y: { label: "Y sensor", required: true, selector: entity("sensor") },
          },
        },
      },
    },
    {
      name: "zones",
      selector: {
        object: {
          multiple: true,
          label_field: "polygon",
          description_field: "presence",
          fields: {
            polygon: { label: "Zone", required: true, selector: entity("text") },
            presence: { label: "Presence sensor", selector: entity("binary_sensor") },
          },
        },
      },
    },
  ] satisfies FormField[],
  computeLabel: (schema: { name: string }) => LABELS[schema.name],
  computeHelper: (schema: { name: string }) => HELPERS[schema.name],
};

const isEntityId = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * The overrides of a card config for discovery. Items the visual editor is still filling in (an entity not picked
 * yet) are left out until they're complete.
 */
export function configOverrides(config: DiscoveryOverrides): DiscoveryOverrides {
  return {
    device_id: isEntityId(config.device_id) ? config.device_id : undefined,
    targets: config.targets?.filter((t) => isEntityId(t.x) && isEntityId(t.y)),
    zones: config.zones
      ?.filter((z) => isEntityId(z.polygon))
      .map((z) => ({ polygon: z.polygon, presence: isEntityId(z.presence) ? z.presence : undefined })),
  };
}
