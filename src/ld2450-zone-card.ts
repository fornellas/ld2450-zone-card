import { LitElement, css, html, nothing } from "lit";
import { discover, type DiscoveryOverrides, type Ld2450Device, type Zone } from "./discovery";
import type { EntityNameType, HomeAssistant, LovelaceCardConfig } from "./ha-types";
import { fetchEntityIdParts } from "./naming";
import { POLYGON_MAX_POINTS, type Point, checkPolygon, formatPolygon, parsePolygon } from "./polygon";
import { formatRoomText, parseRoomText, textUnit } from "./polygon-text";
import { readTargets } from "./targets";
import {
  type SystemSettings,
  deviceMount,
  saveSystemSettings,
  subscribeSystemSettings,
  withDeviceMount,
} from "./system-settings";
import { type Mount, toRadar, toRoom } from "./transform";
import { type Units, defaultUnits, snapStep } from "./units";
import { type UserSettings, fetchUserSettings, saveUserSettings } from "./user-settings";
import "./mount-editor";
import "./zone-map";

const SAVE_DELAY_MS = 500;

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
    _entityIdParts: { state: true },
    _userSettings: { state: true },
    _systemSettings: { state: true },
    _saveError: { state: true },
    _drafts: { state: true },
    _selectedVertex: { state: true },
    _text: { state: true },
  };

  hass?: HomeAssistant;
  private _config?: Ld2450ZoneCardConfig;
  private _deviceId?: string;
  private _zoneId?: string;
  private _entityIdParts?: EntityNameType[];
  private _userSettings?: UserSettings;
  private _systemSettings?: SystemSettings;
  private _unsubscribeSystem?: Promise<() => void>;
  private _saveTimer?: ReturnType<typeof setTimeout>;
  private _saveError?: string;
  /** Edited polygons not yet written to the device, in radar coordinates, by zone entity. */
  private _drafts: Record<string, Point[]> = {};
  private _selectedVertex?: number;
  /** The polygon text while the user is typing it, with why it can't be read, if so. */
  private _text?: { value: string; error?: string };

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

  override willUpdate(): void {
    if (this.hass !== undefined && this._entityIdParts === undefined) {
      this._entityIdParts = [];
      fetchEntityIdParts(this.hass).then((parts) => (this._entityIdParts = parts));
    }
    if (this.hass !== undefined && this._userSettings === undefined) {
      this._userSettings = {};
      fetchUserSettings(this.hass).then((settings) => (this._userSettings = { ...settings, ...this._userSettings }));
    }
    if (this.hass !== undefined && this._unsubscribeSystem === undefined && this.isConnected) {
      this._unsubscribeSystem = subscribeSystemSettings(this.hass, (settings) => {
        // Don't let an echo of an older value undo a change that is still waiting to be saved
        if (this._saveTimer === undefined) this._systemSettings = settings;
      });
      this._unsubscribeSystem.catch((err) => {
        console.warn("ld2450-zone-card: could not read the radar positions", err);
        this._systemSettings = {};
      });
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Subscribes again in willUpdate after being moved around the dashboard
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribeSystem?.then((unsubscribe) => unsubscribe()).catch(() => undefined);
    this._unsubscribeSystem = undefined;
  }

  private _mountChanged(deviceId: string, mount: Mount): void {
    this._systemSettings = withDeviceMount(this._systemSettings ?? {}, deviceId, mount);
    this._saveError = undefined;
    clearTimeout(this._saveTimer);
    // Typing in a number field fires a change per step; save once it settles
    this._saveTimer = setTimeout(() => {
      this._saveTimer = undefined;
      saveSystemSettings(this.hass!, this._systemSettings!).catch((err) => {
        this._saveError = `Could not save the radar position: ${err?.message ?? err}`;
      });
    }, SAVE_DELAY_MS);
  }

  private get _units(): Units {
    return this._userSettings?.units ?? defaultUnits(this.hass?.config?.unit_system?.length);
  }

  private _setUnits(units: Units): void {
    this._userSettings = { ...this._userSettings, units };
    saveUserSettings(this.hass!, this._userSettings).catch((err) =>
      console.warn("ld2450-zone-card: could not save user settings", err),
    );
  }

  override render() {
    // Wait for the entity ID format, so device names don't change after the first render
    if (!this._config || !this.hass || !this._entityIdParts?.length) return nothing;
    const devices = discover(this.hass, this._config, this._entityIdParts);
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
    const mount = deviceMount(this._systemSettings, device.id);
    const editing = zone === undefined ? undefined : this._editing(zone);
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
      <div class="toolbar">
        <div class="segmented" role="group" aria-label="Units">
          ${(["metric", "imperial"] as const).map(
            (u) =>
              html`<button aria-pressed=${String(this._units === u)} @click=${() => this._setUnits(u)}>
                ${u === "metric" ? "Metric" : "Imperial"}
              </button>`,
          )}
        </div>
      </div>
      <details class="mount">
        <summary>Radar position</summary>
        <ld2450-mount-editor
          .mount=${mount}
          .units=${this._units}
          ?disabled=${!this.hass!.user?.is_admin || this._systemSettings === undefined}
          @mount-changed=${(ev: CustomEvent<Mount>) => this._mountChanged(device.id, ev.detail)}
        ></ld2450-mount-editor>
        ${this._saveError === undefined ? nothing : html`<p class="error">${this._saveError}</p>`}
      </details>
      <ld2450-zone-map
        .mount=${mount}
        .units=${this._units}
        .targets=${readTargets(this.hass!, device.targets)}
        .zones=${device.zones.map((z) => ({
          name: z.name,
          points: parsePolygon(this.hass!.states[z.polygon]?.state ?? "") ?? [],
          selected: z.polygon === zone?.polygon,
          occupied: z.presence !== undefined && this.hass!.states[z.presence]?.state === "on",
        }))}
        ?editable=${zone !== undefined}
        .draft=${editing?.points ?? []}
        .deviceOutline=${editing?.dirty ? editing.devicePoints : undefined}
        .outside=${editing?.check.outside ?? []}
        .selectedVertex=${this._selectedVertex}
        .snapStep=${this._snap ? snapStep(this._units) : 0}
        @draft-changed=${(ev: CustomEvent<Point[]>) => zone && this._setDraft(zone, ev.detail)}
        @vertex-selected=${(ev: CustomEvent<number | undefined>) => (this._selectedVertex = ev.detail)}
      ></ld2450-zone-map>
      ${zone === undefined || editing === undefined ? nothing : this._renderEditor(zone, mount, editing)}
      <details>
        <summary>Entities</summary>
        ${zone === undefined ? nothing : this._renderZone(zone)} ${this._renderTargets(device)}
      </details>
      ${
        device.warnings.length === 0
          ? nothing
          : html`<ul class="warnings">
              ${device.warnings.map((w) => html`<li>${w}</li>`)}
            </ul>`
      }
    `;
  }

  /** The selected zone's polygon being edited: the draft, or what the device has. */
  private _editing(zone: Zone) {
    const deviceState = this.hass!.states[zone.polygon]?.state ?? "unavailable";
    const devicePoints = parsePolygon(deviceState);
    const draft = this._drafts[zone.polygon];
    const points = draft ?? devicePoints ?? [];
    return {
      points,
      devicePoints,
      deviceState,
      dirty: draft !== undefined && formatPolygon(draft) !== deviceState,
      check: checkPolygon(points),
    };
  }

  private _renderEditor(zone: Zone, mount: Mount, editing: ReturnType<Ld2450ZoneCard["_editing"]>) {
    const { points, check } = editing;
    const text =
      this._text?.value ??
      formatRoomText(
        points.map((p) => toRoom(p, mount)),
        this._units,
      );
    const deviceValue = formatPolygon(points);
    const full = points.length >= POLYGON_MAX_POINTS;
    return html`
      <div class="editor">
        <p class="help">
          ${
            full
              ? html`This zone has the most points it can have (${POLYGON_MAX_POINTS}).`
              : html`Click the map to add a point, or click an edge to add one there.`
          }
          Drag a point to move it; double-click it, or select it and press Delete, to remove it.
        </p>
        <div class="edit-toolbar">
          <label class="check">
            <input type="checkbox" .checked=${this._snap} @change=${this._snapChanged} />
            Snap to grid
          </label>
          <span class="spacer"></span>
          <button
            ?disabled=${this._selectedVertex === undefined || this._selectedVertex >= points.length}
            @click=${() => this._deletePoint(zone, points)}
          >
            Delete point
          </button>
          <button ?disabled=${points.length === 0} @click=${() => this._setDraft(zone, [])}>Clear</button>
          <button ?disabled=${!editing.dirty} @click=${() => this._revert(zone)}>Revert</button>
        </div>
        <label class="points">
          Points (x,y in ${textUnit(this._units)}, room coordinates)
          <textarea
            rows="3"
            spellcheck="false"
            .value=${text}
            @input=${(ev: Event) => this._textInput(zone, mount, (ev.target as HTMLTextAreaElement).value)}
            @change=${this._textChange}
          ></textarea>
        </label>
        <div class="device-value">
          <span>To write to the device (radar mm):</span>
          <code>${deviceValue === "" ? "(empty: zone disabled)" : deviceValue}</code>
        </div>
        <div class="status">
          <span>${points.length} / ${POLYGON_MAX_POINTS} points</span>
          ${editing.dirty ? html`<span class="dirty">Unsaved changes</span>` : nothing}
        </div>
        ${
          this._text?.error === undefined && check.errors.length === 0
            ? nothing
            : html`<ul class="errors">
                ${this._text?.error === undefined ? nothing : html`<li>${this._text.error}</li>`}
                ${check.errors.map((e) => html`<li>${e}</li>`)}
              </ul>`
        }
      </div>
    `;
  }

  private _setDraft(zone: Zone, points: Point[]): void {
    this._drafts = { ...this._drafts, [zone.polygon]: points };
    this._text = undefined;
    if (this._selectedVertex !== undefined && this._selectedVertex >= points.length) this._selectedVertex = undefined;
  }

  private _deletePoint(zone: Zone, points: Point[]): void {
    const index = this._selectedVertex;
    if (index === undefined) return;
    this._setDraft(
      zone,
      points.filter((_, i) => i !== index),
    );
    this._selectedVertex = undefined;
  }

  private _revert(zone: Zone): void {
    const { [zone.polygon]: _, ...rest } = this._drafts;
    this._drafts = rest;
    this._text = undefined;
    this._selectedVertex = undefined;
  }

  private _textInput(zone: Zone, mount: Mount, value: string): void {
    const parsed = parseRoomText(value, this._units);
    if (typeof parsed === "string") {
      // Keep what was typed, and the last polygon that could be read
      this._text = { value, error: parsed };
      return;
    }
    this._drafts = { ...this._drafts, [zone.polygon]: parsed.map((p) => toRadar(p, mount)) };
    this._text = { value };
    this._selectedVertex = undefined;
  }

  /** Leaving the text: show the polygon in use, unless the text can't be read and still needs fixing. */
  private _textChange(): void {
    if (this._text?.error === undefined) this._text = undefined;
  }

  private get _snap(): boolean {
    return this._userSettings?.snap ?? true;
  }

  private _snapChanged(ev: Event): void {
    this._userSettings = { ...this._userSettings, snap: (ev.target as HTMLInputElement).checked };
    saveUserSettings(this.hass!, this._userSettings).catch((err) =>
      console.warn("ld2450-zone-card: could not save user settings", err),
    );
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
    this._selectedVertex = undefined;
    this._text = undefined;
  }

  private _zoneChanged(ev: Event): void {
    this._zoneId = (ev.target as HTMLSelectElement).value;
    this._selectedVertex = undefined;
    this._text = undefined;
  }

  static override styles = css`
    .toolbar {
      display: flex;
      justify-content: flex-end;
      margin: 12px 0 8px;
    }
    .segmented {
      display: inline-flex;
      border: 1px solid var(--divider-color);
      border-radius: 4px;
      overflow: hidden;
    }
    .segmented button {
      padding: 4px 12px;
      font: inherit;
      font-size: 0.85em;
      color: var(--primary-text-color);
      background: none;
      border: none;
      cursor: pointer;
    }
    .segmented button + button {
      border-left: 1px solid var(--divider-color);
    }
    .segmented button[aria-pressed="true"] {
      color: var(--text-primary-color);
      background: var(--primary-color);
    }
    details {
      margin-top: 12px;
    }
    details.mount {
      margin: 0 0 12px;
    }
    details.mount[open] summary {
      margin-bottom: 12px;
    }
    .error {
      margin: 8px 0 0;
      color: var(--error-color);
    }
    summary {
      cursor: pointer;
      color: var(--secondary-text-color);
    }
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
    .editor {
      margin-top: 12px;
    }
    .help {
      margin: 0 0 8px;
      font-size: 0.85em;
      color: var(--secondary-text-color);
    }
    .edit-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .spacer {
      flex: 1;
    }
    .edit-toolbar button {
      padding: 6px 12px;
      font: inherit;
      font-size: 0.9em;
      color: var(--primary-color);
      background: none;
      border: 1px solid var(--divider-color);
      border-radius: 4px;
      cursor: pointer;
    }
    .edit-toolbar button:disabled {
      color: var(--disabled-text-color, #bdbdbd);
      cursor: default;
    }
    label.check {
      display: flex;
      flex-direction: row;
      align-items: center;
      flex: 0 0 auto;
      font-size: 1em;
      color: var(--primary-text-color);
    }
    label.points {
      margin-top: 12px;
    }
    textarea {
      box-sizing: border-box;
      width: 100%;
      padding: 8px;
      font-family: var(--code-font-family, monospace);
      font-size: 0.95em;
      color: var(--primary-text-color);
      background: var(--card-background-color);
      border: 1px solid var(--divider-color);
      border-radius: 4px;
      resize: vertical;
    }
    .device-value {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
      margin-top: 8px;
      font-size: 0.85em;
      color: var(--secondary-text-color);
    }
    .device-value code {
      overflow-wrap: anywhere;
    }
    .status {
      display: flex;
      gap: 16px;
      margin-top: 4px;
      font-size: 0.85em;
      color: var(--secondary-text-color);
    }
    .dirty {
      color: var(--warning-color);
    }
    .errors {
      margin: 8px 0 0;
      padding-left: 20px;
      color: var(--error-color);
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
