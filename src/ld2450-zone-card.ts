import { LitElement, css, html, nothing } from "lit";
import { DETECTION_AREA } from "./detection-area";
import { discover, type DiscoveryOverrides, type Ld2450Device, type Zone } from "./discovery";
import { clipToRect, insidePolygon, perimeter } from "./geometry";
import type { EntityNameType, HomeAssistant, LovelaceCardConfig } from "./ha-types";
import { fetchEntityIdParts } from "./naming";
import {
  FLOOR_PLAN_MAX_POINTS,
  POLYGON_MAX_POINTS,
  type Point,
  type PolygonCheck,
  checkFloorPlan,
  POLYGON_MAX_X,
  POLYGON_MAX_Y,
  POLYGON_MIN_X,
  POLYGON_MIN_Y,
  checkPolygon,
  formatPolygon,
  parsePolygon,
} from "./polygon";
import { type TargetPosition, readTargets } from "./targets";
import {
  type SystemSettings,
  deviceFloorPlan,
  deviceMount,
  saveSystemSettings,
  subscribeSystemSettings,
  withDeviceMount,
  withFloorPlan,
} from "./system-settings";
import { type Mount, toRadar, toRoom } from "./transform";
import {
  DEFAULT_SNAP,
  DEFAULT_TRAIL_MARGIN,
  MAX_SNAP,
  MAX_TRAIL_MARGIN,
  MIN_SNAP,
  type Units,
  defaultUnits,
  formatLength,
  fromInputValue,
  inputUnit,
  toInputValue,
} from "./units";
import { type Overlay, type UserSettings, fetchUserSettings, saveUserSettings } from "./user-settings";
import "./mount-editor";
import "./zone-map";
import type { DraftChange } from "./zone-map";

// Settings are saved once edits settle for this long
const SAVE_DELAY_MS = 500;

/** The "Edit" choice for the floor plan, next to the zones. */
const FLOOR_PLAN = "floor-plan";

/** What can be edited: a zone (saved to the device) or the device's floor plan (saved in HA). */
type Target = { kind: "zone"; key: string; zone: Zone } | { kind: "floorPlan"; key: string; device: Ld2450Device };

// Most undo steps kept for each polygon
const MAX_UNDO = 100;
// Most target positions kept in the trail of each device. Each is an SVG circle, repainted whenever the map changes:
// measured, 5k-10k keeps redraws around a frame or two on phones, while memory stays a few MB
const MAX_TRAIL = 7000;

/** Drafts before (undo) and after (redo) each change; undefined is "no draft", i.e. what's saved. */
interface History {
  undo: (Point[] | undefined)[];
  redo: (Point[] | undefined)[];
  /** The gesture of the last change (a drag, or typing), whose further changes are undone together. */
  gesture?: string;
}

/** The polygon being edited. */
interface Editing {
  /** The draft, or what's saved, in radar coordinates. */
  points: Point[];
  roomPoints: Point[];
  /** What's saved, in radar coordinates; undefined when a zone's state isn't a polygon (e.g. unavailable). */
  savedPoints?: Point[];
  /** A zone's state on the device. */
  deviceState?: string;
  /** The draft differs from what's saved. */
  dirty: boolean;
  check: PolygonCheck;
}

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
    _mountError: { state: true },
    _snapText: { state: true },
    _saving: { state: true },
    _saveResult: { state: true },
    _drafts: { state: true },
    _selectedVertex: { state: true },
    _pointText: { state: true },
    _history: { state: true },
    _trailOn: { state: true },
    _marginText: { state: true },
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
  private _mountError?: string;
  /** The snap step while the user is typing it. */
  private _snapText?: string;
  private _snapSaveTimer?: ReturnType<typeof setTimeout>;
  /** The polygon being written to a zone, until the device publishes it back. */
  private _saving?: { zone: string; value: string };
  private _savingTimer?: ReturnType<typeof setTimeout>;
  /** How the last write went, for the zone it was written to. */
  private _saveResult?: { zone: string; ok: boolean; message: string };

  /** How long the device has to publish a written polygon back before the write counts as rejected. */
  static saveTimeoutMs = 5000;
  /** Edited polygons not saved yet, in radar coordinates, by target key. */
  private _drafts: Record<string, Point[]> = {};
  private _selectedVertex?: number;
  /** A coordinate of the selected point while the user is typing it. */
  private _pointText?: { axis: "x" | "y"; value: string };
  /** Undo and redo, by target key. */
  private _history: Record<string, History> = {};
  /** What's being edited, for keyboard shortcuts. */
  private _currentTarget?: Target;
  /** The device shown. */
  private _currentDevice?: string;
  /** Whether the trail is on. Off on every load. */
  private _trailOn = false;
  /** The trail margin while the user is typing it. */
  private _marginText?: string;
  private _marginSaveTimer?: ReturnType<typeof setTimeout>;
  /** Where targets have been seen while the trail is on, in radar coordinates, by device. Kept in this page only. */
  private _trails: Record<string, Point[]> = {};
  /** The last position recorded for each target, so a target standing still isn't recorded again and again. */
  private _trailLast: Record<string, Record<string, string>> = {};

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
    this._checkSaved();
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
    this.addEventListener("keydown", this._keydown);
    // Subscribes again in willUpdate after being moved around the dashboard
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("keydown", this._keydown);
    this._unsubscribeSystem?.then((unsubscribe) => unsubscribe()).catch(() => undefined);
    this._unsubscribeSystem = undefined;
    clearTimeout(this._savingTimer);
  }

  private _mountChanged(deviceId: string, mount: Mount): void {
    this._systemSettings = withDeviceMount(this._systemSettings ?? {}, deviceId, mount);
    this._mountError = undefined;
    clearTimeout(this._saveTimer);
    // Typing in a number field fires a change per step; save once it settles
    this._saveTimer = setTimeout(() => {
      this._saveTimer = undefined;
      saveSystemSettings(this.hass!, this._systemSettings!).catch((err) => {
        this._mountError = `Could not save the radar position: ${err?.message ?? err}`;
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
    return html`
      <ha-card .header=${this._config.title ?? "LD2450 Zones"}>
        <div class="card-content">
          ${device === undefined ? this._renderEmpty() : this._renderDevice(devices, device)}
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

  /** What's selected for editing: a zone, or the device's floor plan. */
  private _target(device: Ld2450Device): Target | undefined {
    if (this._zoneId === FLOOR_PLAN) return { kind: "floorPlan", key: `${FLOOR_PLAN}:${device.id}`, device };
    const zone = device.zones.find((z) => z.polygon === this._zoneId) ?? device.zones[0];
    return zone === undefined ? undefined : { kind: "zone", key: zone.polygon, zone };
  }

  private _renderDevice(devices: Ld2450Device[], device: Ld2450Device) {
    const mount = deviceMount(this._systemSettings, device.id);
    const floorPlan = deviceFloorPlan(this._systemSettings, device.id);
    const target = this._target(device);
    this._currentTarget = target;
    this._currentDevice = device.id;
    const editing = target === undefined ? undefined : this._editing(target, mount, floorPlan);
    const offline = this._isOffline(device);
    const targets = readTargets(this.hass!, device.targets);
    if (this._trailOn) this._recordTrail(device.id, targets);
    return html`
      <div class="selectors">
        <label>
          Device
          <select @change=${this._deviceChanged} ?disabled=${devices.length < 2}>
            ${devices.map((d) => {
              const label = this._isOffline(d) ? `${d.name} (offline)` : d.name;
              return html`<option value=${d.id} ?selected=${d.id === device.id}>${label}</option>`;
            })}
          </select>
        </label>
        <label>
          Edit
          <select @change=${this._zoneChanged}>
            ${device.zones.map(
              (z) => html`<option value=${z.polygon} ?selected=${target?.key === z.polygon}>${z.name}</option>`,
            )}
            <option value=${FLOOR_PLAN} ?selected=${target?.kind === "floorPlan"}>Floor plan</option>
          </select>
        </label>
      </div>
      ${
        offline
          ? html`<p class="error offline">
              ${device.name} is offline. Its zones and targets will show again once it's back, and changes can be saved
              then.
            </p>`
          : nothing
      }
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
      <ld2450-zone-map
        .mount=${mount}
        .units=${this._units}
        .targets=${targets}
        .trail=${this._trails[device.id] ?? []}
        ?trailShown=${this._trailOn}
        .floorPlan=${floorPlan}
        ?editingFloorPlan=${target?.kind === "floorPlan"}
        .overlays=${this._userSettings?.overlays ?? {}}
        .zones=${device.zones.map((z) => ({
          name: z.name,
          points: parsePolygon(this.hass!.states[z.polygon]?.state ?? "") ?? [],
          selected: target?.key === z.polygon,
          occupied: z.presence !== undefined && this.hass!.states[z.presence]?.state === "on",
        }))}
        ?editable=${target !== undefined}
        .draft=${editing?.points ?? []}
        .deviceOutline=${editing?.dirty ? editing.savedPoints : undefined}
        .outside=${editing?.check.outside ?? []}
        .selectedVertex=${this._selectedVertex}
        .snapStep=${this._snap ? this._snapStep : 0}
        ?snapToPoints=${this._snapToPoints}
        @draft-changed=${(ev: CustomEvent<DraftChange>) =>
          target && this._setDraft(target, ev.detail.points, ev.detail.gesture)}
        @vertex-selected=${(ev: CustomEvent<number | undefined>) => this._selectVertex(ev.detail)}
        @overlay-toggled=${(ev: CustomEvent<{ overlay: Overlay; shown: boolean }>) =>
          this._toggleOverlay(ev.detail.overlay, ev.detail.shown)}
      ></ld2450-zone-map>
      ${this._renderTargetPositions(targets, mount, offline)}
      ${
        target === undefined || editing === undefined
          ? nothing
          : this._renderEditor(target, mount, editing, offline, this._trails[device.id] ?? [])
      }
      <details class="grid">
        <summary>Grid</summary>
        <div class="snap-row">
          <label class="check">
            <input type="checkbox" .checked=${this._snap} @change=${this._snapChanged} />
            Snap to grid
          </label>
          ${
            this._snap
              ? html`<label class="inline snap-step">
                  Step (${inputUnit(this._units)})
                  <input
                    type="number"
                    min=${toInputValue(MIN_SNAP, this._units)}
                    max=${toInputValue(MAX_SNAP, this._units)}
                    step=${this._units === "metric" ? 0.01 : 0.05}
                    .value=${this._snapText ?? String(toInputValue(this._snapStep, this._units))}
                    @input=${this._snapStepInput}
                    @change=${() => (this._snapText = undefined)}
                  />
                </label>`
              : nothing
          }
        </div>
        <h4>Radar</h4>
        <ld2450-mount-editor
          .mount=${mount}
          .units=${this._units}
          ?disabled=${!this._isAdmin || this._systemSettings === undefined}
          @mount-changed=${(ev: CustomEvent<Mount>) => this._mountChanged(device.id, ev.detail)}
        ></ld2450-mount-editor>
        ${this._mountError === undefined ? nothing : html`<p class="error">${this._mountError}</p>`}
      </details>
      ${
        device.warnings.length === 0
          ? nothing
          : html`<ul class="warnings">
              ${device.warnings.map((w) => html`<li>${w}</li>`)}
            </ul>`
      }
      <details>
        <summary>Entities</summary>
        ${target?.kind === "zone" ? this._renderZone(target.zone) : nothing} ${this._renderTargets(device)}
      </details>
    `;
  }

  /** Where the targets are now, in room coordinates. */
  private _renderTargetPositions(targets: TargetPosition[], mount: Mount, offline: boolean) {
    return html`
      <section class="targets">
        ${
          targets.length === 0
            ? html`<p class="none">${offline ? "Radar offline" : "No targets tracked"}</p>`
            : html`<ul>
                ${targets.map((t) => {
                  const p = toRoom(t.point, mount);
                  return html`<li>
                    <span class="name">Target ${t.label}</span>
                    <span class="position">
                      x ${formatLength(p.x, this._units)}, y ${formatLength(p.y, this._units)}
                    </span>
                  </li>`;
                })}
              </ul>`
        }
      </section>
    `;
  }

  private get _isAdmin(): boolean {
    return this.hass?.user?.is_admin ?? false;
  }

  /** A device is offline when HA has none of its zones: they're all unavailable. */
  private _isOffline(device: Ld2450Device): boolean {
    return device.zones.length > 0 && device.zones.every((z) => this.hass!.states[z.polygon]?.state === "unavailable");
  }

  /** The polygon being edited: the draft, or what's saved, in radar coordinates. */
  private _editing(target: Target, mount: Mount, floorPlan: Point[]): Editing {
    const draft = this._drafts[target.key];
    if (target.kind === "floorPlan") {
      const points = draft ?? floorPlan;
      return {
        points,
        roomPoints: points.map((p) => toRoom(p, mount)),
        savedPoints: floorPlan,
        dirty: draft !== undefined && formatPolygon(draft) !== formatPolygon(floorPlan),
        check: checkFloorPlan(points),
      };
    }
    const deviceState = this.hass!.states[target.key]?.state ?? "unavailable";
    const devicePoints = parsePolygon(deviceState);
    const points = draft ?? devicePoints ?? [];
    return {
      points,
      roomPoints: points.map((p) => toRoom(p, mount)),
      savedPoints: devicePoints,
      deviceState,
      dirty: draft !== undefined && formatPolygon(draft) !== deviceState,
      check: checkPolygon(points, (p) => insidePolygon(p, DETECTION_AREA)),
    };
  }

  private _renderEditor(target: Target, mount: Mount, editing: Editing, offline: boolean, trail: Point[]) {
    const { points, check } = editing;
    const isZone = target.kind === "zone";
    const maxPoints = isZone ? POLYGON_MAX_POINTS : FLOOR_PLAN_MAX_POINTS;
    const full = points.length >= maxPoints;
    const saving = this._saving?.zone === target.key;
    const result = this._saveResult?.zone === target.key ? this._saveResult : undefined;
    const canSave =
      editing.dirty &&
      check.errors.length === 0 &&
      editing.savedPoints !== undefined &&
      this._saving === undefined &&
      (isZone || (this._isAdmin && this._systemSettings !== undefined));
    let cantSave: string | undefined;
    if (!isZone) {
      if (!this._isAdmin) cantSave = "Only administrators can save the floor plan.";
    } else if (editing.savedPoints === undefined && !offline) {
      // The offline notice covers a zone that is unavailable along with the rest of the device
      cantSave =
        editing.deviceState === "unavailable"
          ? "This zone is unavailable, so changes can't be saved now."
          : "The device hasn't reported this zone yet, so changes can't be saved now.";
    }
    return html`
      <details class="edit" open>
        <summary>Edit</summary>
        <p class="help">
          ${
            full
              ? html`This ${isZone ? "zone" : "floor plan"} has the most points it can have (${maxPoints}).`
              : html`Click the map to add a point, or click an edge to add one there.`
          }
          Drag a point to move it. To remove a point, select it and use Delete point, or double-click it.
        </p>
        <label class="check snap-points">
          <input
            type="checkbox"
            .checked=${this._snapToPoints}
            @change=${(ev: Event) => this._setUserSetting({ snapToPoints: (ev.target as HTMLInputElement).checked })}
          />
          Snap to nearby points
        </label>
        ${this._renderTrail(target, mount, trail)} ${this._renderSelectedPoint(target, mount, editing)}
        <div class="edit-toolbar">
          <button
            title="Undo (Ctrl+Z)"
            ?disabled=${!this._history[target.key]?.undo.length}
            @click=${() => this._undo(target)}
          >
            Undo
          </button>
          <button
            title="Redo (Ctrl+Shift+Z)"
            ?disabled=${!this._history[target.key]?.redo.length}
            @click=${() => this._redo(target)}
          >
            Redo
          </button>
          <button
            ?disabled=${this._selectedVertex === undefined || this._selectedVertex >= points.length}
            @click=${() => this._deletePoint(target, points)}
          >
            Delete point
          </button>
          <button ?disabled=${points.length === 0} @click=${() => this._setDraft(target, [])}>Clear</button>
          <button ?disabled=${!editing.dirty || saving} @click=${() => this._revert(target)}>Revert</button>
          <span class="spacer"></span>
          <button class="save" ?disabled=${!canSave} @click=${() => this._save(target, editing)}>
            ${saving ? "Saving…" : "Save"}
          </button>
        </div>
        ${
          result === undefined
            ? nothing
            : html`<p class=${result.ok ? "saved" : "error"} role="status">${result.message}</p>`
        }
        ${cantSave === undefined ? nothing : html`<p class="error">${cantSave}</p>`}
        ${editing.dirty ? html`<div class="status"><span class="dirty">Unsaved changes</span></div>` : nothing}
        ${
          check.errors.length === 0
            ? nothing
            : html`<ul class="errors">
                ${check.errors.map((e) => html`<li>${e}</li>`)}
              </ul>`
        }
        ${
          check.warnings.length === 0
            ? nothing
            : html`<ul class="edit-warnings">
                ${check.warnings.map((w) => html`<li>${w}</li>`)}
              </ul>`
        }
      </details>
    `;
  }

  /** The selected point's coordinates, in room coordinates and the selected units, to read or type. */
  private _renderSelectedPoint(target: Target, mount: Mount, editing: Editing) {
    const index = this._selectedVertex;
    const point = index === undefined ? undefined : editing.roomPoints[index];
    const unit = inputUnit(this._units);
    return html`
      <h4 class="point-name">${point === undefined ? "Point (none selected)" : `Point ${index! + 1}`}</h4>
      <div class="point">
        ${(["x", "y"] as const).map(
          (axis) => html`
            <label class="inline">
              ${axis.toUpperCase()} (${unit})
              <input
                type="number"
                step=${this._units === "metric" ? 0.01 : 0.05}
                ?disabled=${point === undefined}
                .value=${
                  point === undefined
                    ? ""
                    : this._pointText?.axis === axis
                      ? this._pointText.value
                      : String(toInputValue(point[axis], this._units))
                }
                @input=${(ev: Event) =>
                  this._pointInput(target, mount, editing, axis, (ev.target as HTMLInputElement).value)}
                @change=${this._pointChange}
              />
            </label>
          `,
        )}
      </div>
    `;
  }

  private _renderTrail(target: Target, mount: Mount, trail: Point[]) {
    const isZone = target.kind === "zone";
    return html`
      <div class="trail">
        <label class="check">
          <input
            type="checkbox"
            .checked=${this._trailOn}
            @change=${(ev: Event) => this._toggleTrail((ev.target as HTMLInputElement).checked)}
          />
          Trail
        </label>
        ${
          !this._trailOn
            ? nothing
            : html`
                ${
                  isZone
                    ? html`<label class="inline margin">
                        Margin (${inputUnit(this._units)})
                        <input
                          type="number"
                          min="0"
                          max=${toInputValue(MAX_TRAIL_MARGIN, this._units)}
                          step=${this._units === "metric" ? 0.05 : 0.25}
                          .value=${this._marginText ?? String(toInputValue(this._trailMargin, this._units))}
                          @input=${this._marginInput}
                          @change=${() => (this._marginText = undefined)}
                        />
                      </label>`
                    : nothing
                }
                <button
                  class="clear"
                  ?disabled=${trail.length === 0}
                  @click=${() => this._currentDevice && this._clearTrail(this._currentDevice)}
                >
                  Clear
                </button>
                ${
                  isZone
                    ? html`<button
                        class="fit"
                        ?disabled=${trail.length === 0}
                        @click=${() => this._fitToTrail(target, mount, trail)}
                      >
                        Fit zone to trail
                      </button>`
                    : nothing
                }
              `
        }
      </div>
    `;
  }

  private _save(target: Target, editing: Editing): void {
    if (target.kind === "zone") {
      this._saveZone(target.zone, formatPolygon(editing.points));
    } else {
      this._saveFloorPlan(target, editing.points);
    }
  }

  /** Write the polygon to the device; it's saved once the device publishes the same value back. */
  private async _saveZone(zone: Zone, value: string): Promise<void> {
    this._saving = { zone: zone.polygon, value };
    this._saveResult = undefined;
    try {
      await this.hass!.callService("text", "set_value", { value }, { entity_id: zone.polygon });
    } catch (err) {
      this._saving = undefined;
      this._saveResult = {
        zone: zone.polygon,
        ok: false,
        message: `Not saved: ${(err as Error)?.message ?? err}. Your changes are kept.`,
      };
      return;
    }
    this._checkSaved();
    if (this._saving?.zone !== zone.polygon) return;
    // A rejected polygon makes the device publish its old one again, which HA sees as no change at all
    this._savingTimer = setTimeout(() => {
      if (this._saving?.zone !== zone.polygon || this._saving.value !== value) return;
      this._saving = undefined;
      const kept = this.hass?.states[zone.polygon]?.state;
      this._saveResult = {
        zone: zone.polygon,
        ok: false,
        message:
          `Not saved: the device didn't accept the polygon` +
          (kept === undefined ? "." : `, and kept "${kept === "" ? "(empty)" : kept}".`) +
          " Your changes are kept, so you can fix them and save again.",
      };
    }, Ld2450ZoneCard.saveTimeoutMs);
  }

  /** Whether the device has published the polygon being saved. */
  private _checkSaved(): void {
    const saving = this._saving;
    if (saving === undefined || this.hass?.states[saving.zone]?.state !== saving.value) return;
    clearTimeout(this._savingTimer);
    this._saving = undefined;
    this._saveResult = { zone: saving.zone, ok: true, message: "Saved to the device." };
    this._dropDraftIfSaved(saving.zone, saving.value);
  }

  private async _saveFloorPlan(target: Extract<Target, { kind: "floorPlan" }>, points: Point[]): Promise<void> {
    const plan = points.map((p) => ({ x: Math.round(p.x) + 0, y: Math.round(p.y) + 0 }));
    const value = formatPolygon(plan);
    const settings = withFloorPlan(this._systemSettings ?? {}, target.device.id, plan);
    this._saving = { zone: target.key, value };
    this._saveResult = undefined;
    try {
      await saveSystemSettings(this.hass!, settings);
    } catch (err) {
      this._saving = undefined;
      this._saveResult = {
        zone: target.key,
        ok: false,
        message: `Not saved: ${(err as Error)?.message ?? err}. Your changes are kept.`,
      };
      return;
    }
    this._saving = undefined;
    this._systemSettings = settings;
    this._saveResult = { zone: target.key, ok: true, message: "Floor plan saved." };
    this._dropDraftIfSaved(target.key, value);
  }

  /** Drop the draft once saved, unless it changed while saving. */
  private _dropDraftIfSaved(key: string, value: string): void {
    const draft = this._drafts[key];
    if (draft === undefined || formatPolygon(draft) !== value) return;
    const { [key]: _, ...rest } = this._drafts;
    this._drafts = rest;
  }

  private get _snapStep(): number {
    return this._userSettings?.snapStep?.[this._units] ?? DEFAULT_SNAP[this._units];
  }

  private _saveUserSettings(): void {
    saveUserSettings(this.hass!, this._userSettings!).catch((err) =>
      console.warn("ld2450-zone-card: could not save user settings", err),
    );
  }

  private _snapStepInput(ev: Event): void {
    const text = (ev.target as HTMLInputElement).value;
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value)) return;
    const step = fromInputValue(value, this._units);
    if (step < MIN_SNAP || step > MAX_SNAP) return;
    this._snapText = text;
    this._userSettings = {
      ...this._userSettings,
      snapStep: { ...this._userSettings?.snapStep, [this._units]: step },
    };
    clearTimeout(this._snapSaveTimer);
    this._snapSaveTimer = setTimeout(() => this._saveUserSettings(), SAVE_DELAY_MS);
  }

  /** Add where targets are now to the device's trail. */
  private _recordTrail(deviceId: string, targets: TargetPosition[]): void {
    const last = (this._trailLast[deviceId] ??= {});
    let trail = this._trails[deviceId] ?? [];
    for (const target of targets) {
      const key = `${target.point.x},${target.point.y}`;
      if (last[target.label] === key) continue;
      last[target.label] = key;
      // A new array, so the map redraws
      trail = [...trail, target.point].slice(-MAX_TRAIL);
    }
    this._trails[deviceId] = trail;
  }

  private _clearTrail(deviceId?: string): void {
    if (deviceId === undefined) {
      this._trails = {};
      this._trailLast = {};
    } else {
      this._trails = { ...this._trails, [deviceId]: [] };
    }
    this.requestUpdate();
  }

  private _toggleTrail(shown: boolean): void {
    this._trailOn = shown;
    // The trail starts afresh each time it's turned on
    if (!shown) this._clearTrail();
  }

  private get _trailMargin(): number {
    return this._userSettings?.trailMargin?.[this._units] ?? DEFAULT_TRAIL_MARGIN[this._units];
  }

  private _marginInput(ev: Event): void {
    const text = (ev.target as HTMLInputElement).value;
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value)) return;
    const margin = fromInputValue(value, this._units);
    if (margin < 0 || margin > MAX_TRAIL_MARGIN) return;
    this._marginText = text;
    this._userSettings = {
      ...this._userSettings,
      trailMargin: { ...this._userSettings?.trailMargin, [this._units]: margin },
    };
    clearTimeout(this._marginSaveTimer);
    this._marginSaveTimer = setTimeout(() => this._saveUserSettings(), SAVE_DELAY_MS);
  }

  /**
   * Replace the zone with a perimeter around the trail, keeping the margin to every point. It's built in room
   * coordinates, so its edges line up with the map, then cut to the zone point limits so the device accepts it.
   */
  private _fitToTrail(target: Target, mount: Mount, trail: Point[]): void {
    const room = perimeter(
      trail.map((p) => toRoom(p, mount)),
      this._trailMargin,
    );
    const points = clipToRect(
      room.map((p) => toRadar(p, mount)),
      { x: POLYGON_MIN_X, y: POLYGON_MIN_Y },
      { x: POLYGON_MAX_X, y: POLYGON_MAX_Y },
    );
    this._setDraft(target, points);
  }

  private _toggleOverlay(overlay: Overlay, shown: boolean): void {
    this._userSettings = { ...this._userSettings, overlays: { ...this._userSettings?.overlays, [overlay]: shown } };
    this._saveUserSettings();
  }

  /** Remember the draft before a change, for undo. Further changes of the same gesture are undone with it. */
  private _remember(key: string, gesture?: string): void {
    const history = this._history[key] ?? { undo: [], redo: [] };
    if (gesture !== undefined && history.gesture === gesture) return;
    this._history = {
      ...this._history,
      [key]: { undo: [...history.undo, this._drafts[key]].slice(-MAX_UNDO), redo: [], gesture },
    };
  }

  /** Set the draft, or drop it to go back to what's saved. */
  private _putDraft(key: string, draft: Point[] | undefined): void {
    if (draft === undefined) {
      const { [key]: _, ...rest } = this._drafts;
      this._drafts = rest;
    } else {
      this._drafts = { ...this._drafts, [key]: draft };
    }
    this._pointText = undefined;
    this._selectedVertex = undefined;
    this._saveResult = undefined;
  }

  private _undo(target: Target): void {
    const history = this._history[target.key];
    if (!history?.undo.length) return;
    const previous = history.undo[history.undo.length - 1];
    this._history = {
      ...this._history,
      [target.key]: { undo: history.undo.slice(0, -1), redo: [...history.redo, this._drafts[target.key]] },
    };
    this._putDraft(target.key, previous);
  }

  private _redo(target: Target): void {
    const history = this._history[target.key];
    if (!history?.redo.length) return;
    const next = history.redo[history.redo.length - 1];
    this._history = {
      ...this._history,
      [target.key]: { undo: [...history.undo, this._drafts[target.key]], redo: history.redo.slice(0, -1) },
    };
    this._putDraft(target.key, next);
  }

  /** Ctrl+Z undoes, Ctrl+Shift+Z or Ctrl+Y redoes (⌘ on Macs). Text fields keep their own undo. */
  private _keydown = (ev: KeyboardEvent): void => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || this._currentTarget === undefined) return;
    const origin = ev.composedPath()[0] as HTMLElement | undefined;
    if (origin !== undefined && ["INPUT", "TEXTAREA", "SELECT"].includes(origin.tagName)) return;
    const key = ev.key.toLowerCase();
    if (key === "z" && !ev.shiftKey) {
      this._undo(this._currentTarget);
    } else if ((key === "z" && ev.shiftKey) || key === "y") {
      this._redo(this._currentTarget);
    } else {
      return;
    }
    ev.preventDefault();
  };

  /** Set the draft from points in radar coordinates. */
  private _setDraft(target: Target, points: Point[], gesture?: string): void {
    this._remember(target.key, gesture);
    this._drafts = { ...this._drafts, [target.key]: points };
    this._pointText = undefined;
    this._saveResult = undefined;
    if (this._selectedVertex !== undefined && this._selectedVertex >= points.length) this._selectedVertex = undefined;
  }

  private _deletePoint(target: Target, points: Point[]): void {
    const index = this._selectedVertex;
    if (index === undefined) return;
    this._setDraft(
      target,
      points.filter((_, i) => i !== index),
    );
    this._selectedVertex = undefined;
  }

  private _revert(target: Target): void {
    this._remember(target.key);
    this._putDraft(target.key, undefined);
  }

  private _selectVertex(index: number | undefined): void {
    this._selectedVertex = index;
    this._pointText = undefined;
  }

  /** Typing a coordinate of the selected point moves it. Typing until the field loses focus is undone in one step. */
  private _pointInput(target: Target, mount: Mount, editing: Editing, axis: "x" | "y", text: string): void {
    const index = this._selectedVertex;
    const value = Number(text);
    if (index === undefined || text.trim() === "" || !Number.isFinite(value)) return;
    const room = { ...editing.roomPoints[index], [axis]: fromInputValue(value, this._units) };
    const points = [...editing.points];
    points[index] = toRadar(room, mount);
    this._setDraft(target, points, `point-${index}-${axis}`);
    this._pointText = { axis, value: text };
  }

  /** Leaving a coordinate: show the value in use, and start a new undo step. */
  private _pointChange(): void {
    this._pointText = undefined;
    for (const [key, history] of Object.entries(this._history)) {
      if (history.gesture?.startsWith("point-")) {
        this._history = { ...this._history, [key]: { ...history, gesture: undefined } };
      }
    }
  }

  private get _snapToPoints(): boolean {
    return this._userSettings?.snapToPoints ?? true;
  }

  private _setUserSetting(change: Partial<UserSettings>): void {
    this._userSettings = { ...this._userSettings, ...change };
    this._saveUserSettings();
  }

  private get _snap(): boolean {
    return this._userSettings?.snap ?? true;
  }

  private _snapChanged(ev: Event): void {
    this._userSettings = { ...this._userSettings, snap: (ev.target as HTMLInputElement).checked };
    this._saveUserSettings();
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
    this._selectVertex(undefined);
  }

  private _zoneChanged(ev: Event): void {
    this._zoneId = (ev.target as HTMLSelectElement).value;
    this._selectVertex(undefined);
  }

  static override styles = css`
    .toolbar {
      display: flex;
      justify-content: flex-end;
      margin: 12px 0 8px;
    }
    h3 {
      margin: 16px 0 4px;
      font-size: 1em;
      font-weight: 500;
    }
    .targets ul {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      margin: 0;
      padding: 0;
      list-style: none;
      font-variant-numeric: tabular-nums;
    }
    .targets .name {
      font-weight: 500;
      color: var(--primary-text-color);
    }
    .targets .position {
      font-size: 0.85em;
      color: var(--secondary-text-color);
    }
    .targets .none {
      margin: 0;
      color: var(--secondary-text-color);
    }
    details.edit > summary,
    details.grid > summary {
      margin-bottom: 8px;
    }
    .point,
    .trail {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin-bottom: 12px;
    }
    .point-name {
      font-weight: 500;
    }
    /* A label with its field on the same line */
    label.inline {
      flex-direction: row;
      align-items: center;
      flex: 0 0 auto;
      gap: 6px;
    }
    label.inline input {
      width: 4.5em;
    }
    .snap-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      min-height: 2em;
    }
    .trail button {
      padding: 6px 12px;
      font: inherit;
      font-size: 0.9em;
      color: var(--primary-color);
      background: none;
      border: 1px solid var(--divider-color);
      border-radius: 4px;
      cursor: pointer;
    }
    .trail button:disabled {
      color: var(--disabled-text-color, #bdbdbd);
      cursor: default;
    }
    .point input,
    .trail input[type="number"] {
      padding: 4px 8px;
      font: inherit;
      color: var(--primary-text-color);
      background: var(--card-background-color);
      border: 1px solid var(--divider-color);
      border-radius: 4px;
      min-width: 0;
    }
    label.snap-points {
      margin-bottom: 8px;
    }
    details.edit h4,
    details.grid h4 {
      margin: 16px 0 8px;
      font-size: 0.95em;
      font-weight: 500;
    }
    label.snap-step input {
      padding: 4px 8px;
      font: inherit;
      color: var(--primary-text-color);
      background: var(--card-background-color);
      border: 1px solid var(--divider-color);
      border-radius: 4px;
      min-width: 0;
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
    .error {
      margin: 8px 0 0;
      color: var(--error-color);
    }
    summary {
      cursor: pointer;
      color: var(--secondary-text-color);
      list-style: none;
    }
    summary::-webkit-details-marker {
      display: none;
    }
    /* Draw the arrow at a fixed width, and indent the section's content by the same width, so it's clear what's
       inside */
    summary::before {
      content: "▸";
      display: inline-block;
      width: var(--section-indent);
    }
    details[open] > summary::before {
      content: "▾";
    }
    details {
      padding-left: var(--section-indent);
    }
    details > summary {
      margin-left: calc(-1 * var(--section-indent));
    }
    :host {
      --section-indent: 1.25em;
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
    .edit-toolbar button.save {
      color: var(--text-primary-color);
      background: var(--primary-color);
      border-color: var(--primary-color);
    }
    .edit-toolbar button.save:disabled {
      color: var(--disabled-text-color, #bdbdbd);
      background: none;
      border-color: var(--divider-color);
    }
    .saved {
      margin: 8px 0 0;
      color: var(--success-color, #43a047);
    }
    .edit-warnings {
      margin: 8px 0 0;
      padding-left: 20px;
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
