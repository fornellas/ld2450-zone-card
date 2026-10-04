import { LitElement, css, html, nothing } from "lit";
import { discover, type DiscoveryOverrides, type Ld2450Device, type Zone } from "./discovery";
import type { HomeAssistant, LovelaceCardConfig } from "./ha-types";
import { parsePolygon } from "./polygon";

declare const __VERSION__: string;

const CARD_TYPE = "ld2450-zone-card";

export interface Ld2450ZoneCardConfig extends LovelaceCardConfig, DiscoveryOverrides {
  title?: string;
}

function checkEntityList(value: unknown, key: string, fields: string[], required: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error(`"${key}" must be a list`);
  for (const item of value) {
    if (typeof item !== "object" || item === null) throw new Error(`Each "${key}" item must be a mapping`);
    for (const field of fields) {
      const v = (item as Record<string, unknown>)[field];
      if (v === undefined && !required.includes(field)) continue;
      if (typeof v !== "string") throw new Error(`"${key}" items need "${field}" as an entity ID`);
    }
  }
}

export class Ld2450ZoneCard extends LitElement {
  static override properties = {
    hass: { attribute: false },
    _config: { state: true },
    _deviceId: { state: true },
    _zoneId: { state: true },
  };

  hass?: HomeAssistant;
  private _config?: Ld2450ZoneCardConfig;
  private _deviceId?: string;
  private _zoneId?: string;

  static getStubConfig(): Partial<Ld2450ZoneCardConfig> {
    return {};
  }

  setConfig(config: Ld2450ZoneCardConfig): void {
    if (!config) throw new Error("Invalid configuration");
    if (config.device_id !== undefined && typeof config.device_id !== "string") {
      throw new Error('"device_id" must be a device ID');
    }
    checkEntityList(config.targets, "targets", ["x", "y"], ["x", "y"]);
    checkEntityList(config.zones, "zones", ["polygon", "presence"], ["polygon"]);
    this._config = config;
  }

  getCardSize(): number {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  override render() {
    if (!this._config || !this.hass) return nothing;
    const devices = discover(this.hass, this._config);
    const device = devices.find((d) => d.id === this._deviceId) ?? devices[0];
    const zone = device?.zones.find((z) => z.polygon === this._zoneId) ?? device?.zones[0];
    return html`
      <ha-card .header=${this._config.title ?? "LD2450 Zones"}>
        <div class="card-content">
          ${device === undefined ? this._renderEmpty() : this._renderDevice(devices, device, zone)}
        </div>
      </ha-card>
    `;
  }

  private _renderEmpty() {
    return html`
      <p class="empty">
        No LD2450 polygon zones found. The ESPHome device needs firmware with
        <a href="https://github.com/esphome/esphome/pull/20154" target="_blank" rel="noreferrer">polygon zones</a>
        and at least one zone under <code>text: - platform: ld2450</code>.
      </p>
    `;
  }

  private _renderDevice(devices: Ld2450Device[], device: Ld2450Device, zone: Zone | undefined) {
    return html`
      <div class="selectors">
        <label>
          Device
          <select @change=${this._deviceChanged} ?disabled=${devices.length < 2}>
            ${devices.map((d) => html`<option value=${d.id} ?selected=${d.id === device.id}>${d.name}</option>`)}
          </select>
        </label>
        <label>
          Zone
          <select @change=${this._zoneChanged} ?disabled=${device.zones.length === 0}>
            ${device.zones.map(
              (z) => html`<option value=${z.polygon} ?selected=${z.polygon === zone?.polygon}>${z.name}</option>`,
            )}
          </select>
        </label>
      </div>
      ${zone === undefined ? nothing : this._renderZone(zone)} ${this._renderTargets(device)}
      ${
        device.warnings.length === 0
          ? nothing
          : html`<ul class="warnings">
              ${device.warnings.map((w) => html`<li>${w}</li>`)}
            </ul>`
      }
    `;
  }

  private _renderZone(zone: Zone) {
    const state = this.hass!.states[zone.polygon]?.state ?? "unavailable";
    const points = parsePolygon(state);
    const summary =
      points === undefined ? state : points.length === 0 ? "disabled (no polygon)" : `${points.length} points`;
    const presence = zone.presence === undefined ? undefined : this.hass!.states[zone.presence];
    return html`
      <dl>
        <dt>Polygon</dt>
        <dd><code>${zone.polygon}</code>: ${summary}</dd>
        ${
          points !== undefined && points.length > 0
            ? html`<dt>Points</dt>
                <dd><code>${state}</code></dd>`
            : nothing
        }
        <dt>Presence</dt>
        <dd>
          ${
            zone.presence === undefined
              ? html`not found; set <code>zones</code> in the card config`
              : html`<code>${zone.presence}</code>: ${presence?.state ?? "unavailable"}`
          }
        </dd>
      </dl>
    `;
  }

  private _renderTargets(device: Ld2450Device) {
    if (device.targets.length === 0) return nothing;
    const value = (entityId: string) => this.hass!.states[entityId]?.state ?? "unavailable";
    return html`
      <dl>
        <dt>Targets</dt>
        ${device.targets.map(
          (t) =>
            html`<dd>
              ${t.name}: x=${value(t.x)}, y=${value(t.y)} <code>${t.x}</code>
              <code>${t.y}</code>
            </dd>`,
        )}
      </dl>
    `;
  }

  private _deviceChanged(ev: Event): void {
    this._deviceId = (ev.target as HTMLSelectElement).value;
    this._zoneId = undefined;
  }

  private _zoneChanged(ev: Event): void {
    this._zoneId = (ev.target as HTMLSelectElement).value;
  }

  static override styles = css`
    .selectors {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
    }
    label {
      display: flex;
      flex-direction: column;
      flex: 1 1 160px;
      gap: 4px;
      font-size: 0.9em;
      color: var(--secondary-text-color);
    }
    select {
      padding: 8px;
      font: inherit;
      color: var(--primary-text-color);
      background: var(--card-background-color);
      border: 1px solid var(--divider-color);
      border-radius: 4px;
    }
    dl {
      margin: 16px 0 0;
    }
    dt {
      font-weight: 500;
    }
    dd {
      margin: 0 0 8px;
      overflow-wrap: anywhere;
    }
    code {
      font-size: 0.85em;
      color: var(--secondary-text-color);
    }
    .empty {
      color: var(--secondary-text-color);
    }
    .warnings {
      margin: 16px 0 0;
      padding-left: 20px;
      color: var(--warning-color);
    }
  `;
}

if (!customElements.get(CARD_TYPE)) {
  customElements.define(CARD_TYPE, Ld2450ZoneCard);
  window.customCards = window.customCards ?? [];
  window.customCards.push({
    type: CARD_TYPE,
    name: "LD2450 Zone Card",
    description: "Draw polygon zones for ESPHome LD2450 radars",
    preview: false,
    documentationURL: "https://github.com/fornellas/ld2450-zone-card",
  });
  console.info(`%c LD2450-ZONE-CARD %c ${__VERSION__} `, "color: white; background: #03a9f4; font-weight: 700", "");
}
