import { LitElement, css, html, nothing, svg } from "lit";
import { DETECTION_AREA, FIRMWARE_BOUNDS } from "./detection-area";
import { distance, insertionIndex, snap } from "./geometry";
import { POLYGON_MAX_POINTS, type Point } from "./polygon";
import type { TargetPosition } from "./targets";
import type { Overlay } from "./user-settings";

/** An edit from the map. */
export interface DraftChange {
  /** The new points, in radar coordinates. */
  points: Point[];
  /** Set on every change of one drag, so they can be undone as one. */
  gesture?: string;
}

/** A polygon zone to draw, in radar coordinates. */
export interface MapZone {
  name: string;
  points: Point[];
  selected: boolean;
  /** Whether its presence sensor is on. */
  occupied: boolean;
}
import { DEFAULT_MOUNT, type Mount, toRadar, toRoom } from "./transform";
import { type Units, formatGridLabel, formatLength, gridSpacing } from "./units";

const RADAR_WIDTH = 440;
const RADAR_DEPTH = 150;
const HEADING_LENGTH = 700;
const TARGET_RADIUS = 180;
// Smallest area the map shows, in mm, so a lone small zone doesn't fill it
const MIN_MAP_SIZE = 2000;
// Pointer movement, in screen pixels, before pressing a point becomes dragging it
const DRAG_THRESHOLD_PX = 4;
// Smallest radius around a point that grabs it, in screen pixels, so fingers can hit it
const MIN_HIT_RADIUS_PX = 22;

// Touches that start on a point drag it, rather than scroll or zoom the page. touch-action isn't reliable on SVG
// elements (iOS Safari ignores it), so cancel the touch itself; this needs a listener that isn't passive.
const preventTouchDefault = { handleEvent: (ev: Event) => ev.preventDefault(), passive: false };

interface Extent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function extentOf(points: Point[]): Extent {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

/** Grow an extent around its center to at least size wide and high. */
function growTo(e: Extent, size: number): Extent {
  const growX = Math.max(0, size - (e.maxX - e.minX)) / 2;
  const growY = Math.max(0, size - (e.maxY - e.minY)) / 2;
  return { minX: e.minX - growX, maxX: e.maxX + growX, minY: e.minY - growY, maxY: e.maxY + growY };
}

/** SVG y grows downwards, room y grows away from the viewer. */
const pointsAttr = (points: Point[]) => points.map((p) => `${p.x},${-p.y}`).join(" ");

/** Multiples of step within [min, max]. */
function steps(min: number, max: number, step: number): number[] {
  const values: number[] = [];
  // Multiply rather than add, so steps such as 304.8 mm don't drift
  for (let i = Math.ceil(min / step); i * step <= max; i++) values.push(i * step);
  return values;
}

/**
 * Top-down map of the room in room coordinates (mm), with the radar and where it can see.
 *
 * When editable, the selected zone is drawn from `draft` with handles to edit it. Edits fire "draft-changed" with a
 * DraftChange, and "vertex-selected" with the index of the selected point (or undefined).
 */
export class Ld2450ZoneMap extends LitElement {
  static override properties = {
    mount: { attribute: false },
    units: { attribute: false },
    targets: { attribute: false },
    zones: { attribute: false },
    offline: { type: Boolean },
    floorPlan: { attribute: false },
    editingFloorPlan: { type: Boolean },
    overlays: { attribute: false },
    editable: { type: Boolean },
    draft: { attribute: false },
    deviceOutline: { attribute: false },
    outside: { attribute: false },
    selectedVertex: { attribute: false },
    snapStep: { attribute: false },
  };

  mount: Mount = DEFAULT_MOUNT;
  units: Units = "metric";
  targets: TargetPosition[] = [];
  zones: MapZone[] = [];
  /** The radar is offline, so there are no targets to show. */
  offline = false;
  /** The saved floor plan, in radar coordinates. */
  floorPlan: Point[] = [];
  /** The floor plan is the polygon being edited, so the editor draws it instead. */
  editingFloorPlan = false;
  /** Which helper outlines to show; missing ones are shown. */
  overlays: Partial<Record<Overlay, boolean>> = {};
  editable = false;
  /** The selected zone's points being edited, in radar coordinates. */
  draft: Point[] = [];
  /** The selected zone's polygon on the device, drawn when the draft differs from it. */
  deviceOutline?: Point[];
  /** Indexes of draft points outside the limits. */
  outside: number[] = [];
  selectedVertex?: number;
  /** Snap edited points to multiples of this, in room mm. 0 doesn't snap. */
  snapStep = 0;

  /** Size of a point handle, in room mm. */
  private _handle = 100;
  /** Radius around a point that grabs it, in room mm. */
  private _hitRadius = 100;
  /** Rendered width of the map, in screen pixels, to size things in pixels. */
  private _widthPx = 0;
  private _resizeObserver?: ResizeObserver;
  private _drag?: { index: number; startX: number; startY: number; moved: boolean; gesture: string };
  private _drags = 0;

  override render() {
    const area = DETECTION_AREA.map((p) => toRoom(p, this.mount));
    const bounds = FIRMWARE_BOUNDS.map((p) => toRoom(p, this.mount));
    // Keep the room origin in view, so the radar offset can be seen against the axes
    const floorPlan = this.floorPlan.map((p) => toRoom(p, this.mount));
    // Fit what's shown: the radar, the zones, and the outlines that are on. Not the polygon being edited, so the map
    // doesn't rescale while dragging its points.
    const radar = toRoom({ x: 0, y: 0 }, this.mount);
    const shown = [
      radar,
      ...this.zones.flatMap((z) => z.points.map((p) => toRoom(p, this.mount))),
      ...(this._shown("trackingRange") ? area : []),
      ...(this._shown("pointLimits") ? bounds : []),
      ...(this._shown("floorPlan") || this.editingFloorPlan ? floorPlan : []),
    ];
    // With nothing else to show, fit the tracking range rather than a single point
    const fitted = extentOf(shown.length > 1 ? shown : [...shown, ...area]);
    const content = growTo(fitted, MIN_MAP_SIZE);
    const size = Math.max(content.maxX - content.minX, content.maxY - content.minY);
    const font = size * 0.025;
    this._handle = size * 0.018;
    // Room for the axis labels on the left and bottom
    const view: Extent = {
      minX: content.minX - font * 4,
      maxX: content.maxX + font,
      minY: content.minY - font * 2,
      maxY: content.maxY + font,
    };
    const viewBox = `${view.minX} ${-view.maxY} ${view.maxX - view.minX} ${view.maxY - view.minY}`;
    const mmPerPx = this._widthPx > 0 ? (view.maxX - view.minX) / this._widthPx : 0;
    this._hitRadius = Math.max(this._handle, MIN_HIT_RADIUS_PX * mmPerPx);

    return html`
      <svg
        viewBox=${viewBox}
        role="img"
        aria-label="Radar map"
        style="--font: ${font}px"
        class=${this.editable ? "editable" : ""}
        tabindex=${this.editable ? "0" : "-1"}
        @click=${this._backgroundClick}
        @keydown=${this._keydown}
      >
        ${this._renderGrid(view, font)}
        ${
          this._shown("floorPlan") && !this.editingFloorPlan && this.floorPlan.length >= 3
            ? svg`<polygon class="floor-plan" points=${pointsAttr(floorPlan)}></polygon>`
            : nothing
        }
        ${this._shown("pointLimits") ? svg`<polygon class="bounds" points=${pointsAttr(bounds)}></polygon>` : nothing}
        ${this._shown("trackingRange") ? svg`<polygon class="area" points=${pointsAttr(area)}></polygon>` : nothing}
        ${this._renderZones(font)} ${this._renderRadar()} ${this._renderTargets(font)}
        ${this.editable ? this._renderEditor(font) : nothing}
      </svg>
      <div class="legend">
        ${this._renderToggle("trackingRange", "area", "Tracking range")}
        ${this._renderToggle("pointLimits", "bounds", "Zone point limits")}
        ${this._renderToggle("floorPlan", "floor-plan", "Floor plan")}
        <span><i class="swatch zone"></i>Selected zone</span>
        <span><i class="swatch occupied"></i>Occupied</span>
        <span><i class="swatch target"></i>Targets</span>
      </div>
      <div class="readout">
        ${this._renderSelectedVertex()}
        ${
          this.targets.length === 0
            ? html`<span>${this.offline ? "Radar offline" : "No targets tracked"}</span>`
            : this.targets.map((t) => {
                const p = toRoom(t.point, this.mount);
                return html`<span>
                  <b>${t.label}</b> x ${formatLength(p.x, this.units)}, y ${formatLength(p.y, this.units)}
                </span>`;
              })
        }
      </div>
    `;
  }

  private _shown(overlay: Overlay): boolean {
    return this.overlays[overlay] ?? true;
  }

  /** A legend entry that shows or hides an outline. Fires "overlay-toggled" with { overlay, shown }. */
  private _renderToggle(overlay: Overlay, swatch: string, label: string) {
    return html`
      <label class="toggle">
        <input
          type="checkbox"
          .checked=${this._shown(overlay)}
          @change=${(ev: Event) =>
            this._emit("overlay-toggled", { overlay, shown: (ev.target as HTMLInputElement).checked })}
        />
        <i class=${`swatch ${swatch}`}></i>${label}
      </label>
    `;
  }

  private _renderGrid(view: Extent, font: number) {
    const { minor, major } = gridSpacing(this.units);
    const isMajor = (v: number) => Math.abs(v / major - Math.round(v / major)) < 1e-6;
    const lineClass = (v: number) => (Math.abs(v) < 1e-6 ? "axis" : isMajor(v) ? "major" : "minor");
    const xs = steps(view.minX, view.maxX, minor);
    const ys = steps(view.minY, view.maxY, minor);
    return svg`
      <g class="grid">
        ${xs.map((x) => svg`<line class=${lineClass(x)} x1=${x} x2=${x} y1=${-view.minY} y2=${-view.maxY}></line>`)}
        ${ys.map((y) => svg`<line class=${lineClass(y)} x1=${view.minX} x2=${view.maxX} y1=${-y} y2=${-y}></line>`)}
        ${xs
          .filter(isMajor)
          .map(
            (x) =>
              svg`<text class="label" x=${x} y=${-view.minY - font * 0.5} text-anchor="middle">${formatGridLabel(x, this.units)}</text>`,
          )}
        ${ys
          .filter(isMajor)
          .map(
            (y) =>
              svg`<text class="label" x=${view.minX + font * 0.3} y=${-y} dominant-baseline="middle">${formatGridLabel(y, this.units)}</text>`,
          )}
      </g>
    `;
  }

  private _renderTargets(font: number) {
    return this.targets.map((t) => {
      const p = toRoom(t.point, this.mount);
      return svg`
        <g class="target">
          <title>${t.name}: x ${formatLength(p.x, this.units)}, y ${formatLength(p.y, this.units)}</title>
          <circle cx=${p.x} cy=${-p.y} r=${TARGET_RADIUS}></circle>
          <text x=${p.x} y=${-p.y} style="font-size: ${font}px" text-anchor="middle" dominant-baseline="central">
            ${t.label}
          </text>
        </g>
      `;
    });
  }

  private _renderZones(font: number) {
    // The selected zone goes last, so it's drawn on top. While editing, the editor draws it.
    const zones = [...this.zones]
      .filter((z) => !(this.editable && z.selected))
      .filter((z) => z.points.length > 0)
      .sort((a, b) => Number(a.selected) - Number(b.selected));
    return zones.map((zone) => {
      const points = zone.points.map((p) => toRoom(p, this.mount));
      const classes = ["zone", zone.selected ? "selected" : "", zone.occupied ? "occupied" : ""].join(" ");
      return svg`
        <g class=${classes}>
          <title>${zone.name}${zone.occupied ? " (occupied)" : ""}</title>
          <polygon points=${pointsAttr(points)}></polygon>
          ${this._renderZoneName(zone.name, points, font)}
        </g>
      `;
    });
  }

  private _renderZoneName(name: string, points: Point[], font: number) {
    const center = {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };
    return svg`
      <text class="name" x=${center.x} y=${-center.y} style="font-size: ${font}px" text-anchor="middle" dominant-baseline="central">
        ${name}
      </text>
    `;
  }

  private _renderEditor(font: number) {
    const points = this.draft.map((p) => toRoom(p, this.mount));
    const selected = this.zones.find((z) => z.selected);
    const outline = this.deviceOutline?.map((p) => toRoom(p, this.mount));
    // Occupancy comes from the device's polygon: show it there, and not on changes the device doesn't have yet
    const occupied = selected?.occupied ? "occupied" : "";
    const classes = [
      "zone",
      "selected",
      "editing",
      this.editingFloorPlan ? "floor" : outline === undefined ? occupied : "",
    ].join(" ");
    return svg`
      ${
        outline !== undefined && outline.length > 0
          ? svg`<polygon class=${`device-outline ${occupied}`} points=${pointsAttr(outline)}></polygon>`
          : nothing
      }
      <g class=${classes}>
        ${
          points.length >= 3
            ? svg`<polygon points=${pointsAttr(points)}></polygon>`
            : svg`<polyline points=${pointsAttr(points)}></polyline>`
        }
        ${points.length >= 3 && selected !== undefined ? this._renderZoneName(selected.name, points, font) : nothing}
      </g>
      ${points.map((p, i) => {
        const vertexClasses = [
          "vertex",
          i === this.selectedVertex ? "selected" : "",
          this.outside.includes(i) ? "outside" : "",
        ].join(" ");
        return svg`
          <g
            class=${vertexClasses}
            @pointerdown=${(ev: PointerEvent) => this._vertexDown(ev, i)}
            @pointermove=${(ev: PointerEvent) => this._vertexMove(ev)}
            @pointerup=${(ev: PointerEvent) => this._vertexUp(ev)}
            @pointercancel=${(ev: PointerEvent) => this._vertexUp(ev)}
            @click=${(ev: Event) => ev.stopPropagation()}
            @dblclick=${(ev: Event) => this._deleteVertex(ev, i)}
            @touchstart=${preventTouchDefault}
            @touchmove=${preventTouchDefault}
          >
            <circle class="hit" cx=${p.x} cy=${-p.y} r=${this._hitRadius}></circle>
            <circle class="dot" cx=${p.x} cy=${-p.y} r=${this._handle * 0.5}></circle>
            <text x=${p.x + this._handle * 0.8} y=${-p.y - this._handle * 0.8} style="font-size: ${font * 0.8}px">${i + 1}</text>
          </g>
        `;
      })}
    `;
  }

  override firstUpdated(): void {
    const svgEl = this.renderRoot.querySelector("svg");
    if (svgEl === null || typeof ResizeObserver === "undefined") return;
    this._resizeObserver = new ResizeObserver(() => {
      if (svgEl.clientWidth !== this._widthPx) {
        this._widthPx = svgEl.clientWidth;
        this.requestUpdate();
      }
    });
    this._resizeObserver.observe(svgEl);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Observe again after being moved around the page
    if (this.hasUpdated && this._resizeObserver === undefined) this.firstUpdated();
  }

  private _renderSelectedVertex() {
    if (!this.editable || this.selectedVertex === undefined) return nothing;
    const point = this.draft[this.selectedVertex];
    if (point === undefined) return nothing;
    const p = toRoom(point, this.mount);
    return html`<span>
      <b>Point ${this.selectedVertex + 1}</b> x ${formatLength(p.x, this.units)}, y ${formatLength(p.y, this.units)}
    </span>`;
  }

  /** Where a pointer is, in room coordinates. */
  private _roomPoint(ev: MouseEvent): Point | undefined {
    const svgEl = this.renderRoot.querySelector("svg");
    const ctm = svgEl?.getScreenCTM();
    if (!ctm) return undefined;
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: -p.y };
  }

  /** A point from the user, snapped in room coordinates, as radar coordinates. */
  private _toDraftPoint(room: Point): Point {
    return toRadar(snap(room, this.snapStep), this.mount);
  }

  private _emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
  }

  private _backgroundClick(ev: MouseEvent): void {
    if (!this.editable || this.draft.length >= POLYGON_MAX_POINTS) return;
    const room = this._roomPoint(ev);
    if (room === undefined) return;
    const roomPoints = this.draft.map((p) => toRoom(p, this.mount));
    const index = insertionIndex(roomPoints, room, this._hitRadius);
    const draft = [...this.draft];
    draft.splice(index, 0, this._toDraftPoint(room));
    this._emit<DraftChange>("draft-changed", { points: draft });
    this._emit("vertex-selected", index);
  }

  private _vertexDown(ev: PointerEvent, index: number): void {
    ev.stopPropagation();
    try {
      // Keep receiving moves when the pointer leaves the small handle
      (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    } catch {
      // Synthetic events have no active pointer to capture
    }
    this._drag = { index, startX: ev.clientX, startY: ev.clientY, moved: false, gesture: `drag-${++this._drags}` };
    this._emit("vertex-selected", index);
  }

  private _vertexMove(ev: PointerEvent): void {
    const drag = this._drag;
    if (drag === undefined) return;
    if (
      !drag.moved &&
      distance({ x: ev.clientX, y: ev.clientY }, { x: drag.startX, y: drag.startY }) < DRAG_THRESHOLD_PX
    ) {
      return;
    }
    drag.moved = true;
    const room = this._roomPoint(ev);
    if (room === undefined) return;
    const draft = [...this.draft];
    draft[drag.index] = this._toDraftPoint(room);
    this._emit<DraftChange>("draft-changed", { points: draft, gesture: drag.gesture });
  }

  private _vertexUp(ev: PointerEvent): void {
    const target = ev.currentTarget as Element;
    if (target.hasPointerCapture?.(ev.pointerId)) target.releasePointerCapture(ev.pointerId);
    this._drag = undefined;
  }

  private _deleteVertex(ev: Event | undefined, index: number): void {
    ev?.stopPropagation();
    this._emit<DraftChange>("draft-changed", { points: this.draft.filter((_, i) => i !== index) });
    this._emit("vertex-selected", undefined);
  }

  private _keydown(ev: KeyboardEvent): void {
    if (!this.editable) return;
    if ((ev.key === "Delete" || ev.key === "Backspace") && this.selectedVertex !== undefined) {
      ev.preventDefault();
      this._deleteVertex(undefined, this.selectedVertex);
    } else if (ev.key === "Escape") {
      this._emit("vertex-selected", undefined);
    }
  }

  private _renderRadar() {
    const corners = [
      { x: -RADAR_WIDTH / 2, y: -RADAR_DEPTH },
      { x: RADAR_WIDTH / 2, y: -RADAR_DEPTH },
      { x: RADAR_WIDTH / 2, y: 0 },
      { x: -RADAR_WIDTH / 2, y: 0 },
    ].map((p) => toRoom(p, this.mount));
    const origin = toRoom({ x: 0, y: 0 }, this.mount);
    const heading = toRoom({ x: 0, y: HEADING_LENGTH }, this.mount);
    return svg`
      <g class="radar">
        <line x1=${origin.x} y1=${-origin.y} x2=${heading.x} y2=${-heading.y}></line>
        <polygon points=${pointsAttr(corners)}></polygon>
      </g>
    `;
  }

  static override styles = css`
    :host {
      display: block;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
      max-height: 70vh;
    }
    line,
    polygon {
      vector-effect: non-scaling-stroke;
    }
    .grid line {
      stroke: var(--divider-color);
      stroke-width: 1;
    }
    .grid line.minor {
      opacity: 0.5;
    }
    .grid line.axis {
      stroke: var(--secondary-text-color);
      opacity: 0.6;
    }
    .label {
      font-size: var(--font);
      fill: var(--secondary-text-color);
    }
    .area {
      fill: var(--primary-color);
      fill-opacity: 0.07;
      stroke: var(--primary-color);
      stroke-opacity: 0.45;
      stroke-width: 1.5;
    }
    .bounds {
      fill: none;
      stroke: var(--secondary-text-color);
      stroke-width: 1;
      stroke-dasharray: 2 4;
    }
    .radar polygon {
      fill: var(--primary-text-color);
    }
    .radar line {
      stroke: var(--primary-text-color);
      stroke-width: 2;
    }
    .zone polygon {
      fill: var(--secondary-text-color);
      fill-opacity: 0.08;
      stroke: var(--secondary-text-color);
      stroke-width: 1.5;
      stroke-dasharray: 6 4;
    }
    .zone text {
      pointer-events: none;
      fill: var(--secondary-text-color);
    }
    .zone.occupied polygon {
      fill: var(--yellow-color, #ffeb3b);
      fill-opacity: 0.45;
    }
    .zone.selected polygon,
    .zone.selected polyline {
      fill: var(--green-color, #4caf50);
      fill-opacity: 0.2;
      stroke: var(--green-color, #4caf50);
      stroke-width: 2.5;
      stroke-dasharray: none;
    }
    .zone.selected polyline,
    .zone.selected.floor polygon {
      fill: none;
    }
    .zone.selected.occupied polygon {
      fill: var(--yellow-color, #ffeb3b);
      fill-opacity: 0.5;
    }
    .device-outline {
      fill: none;
      stroke: var(--green-color, #4caf50);
      stroke-width: 1.5;
      stroke-dasharray: 2 4;
    }
    .device-outline.occupied {
      fill: var(--yellow-color, #ffeb3b);
      fill-opacity: 0.45;
      stroke: var(--secondary-text-color);
    }
    svg.editable {
      cursor: crosshair;
    }
    svg:focus {
      outline: none;
    }
    .vertex {
      cursor: move;
      touch-action: none;
    }
    .vertex .hit {
      fill: transparent;
    }
    .vertex .dot {
      fill: var(--card-background-color, #fff);
      stroke: var(--green-color, #4caf50);
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
    .vertex.selected .dot {
      fill: var(--green-color, #4caf50);
    }
    .vertex.outside .dot {
      stroke: var(--error-color, #db4437);
    }
    .vertex.outside.selected .dot {
      fill: var(--error-color, #db4437);
    }
    .vertex text {
      fill: var(--primary-text-color);
      pointer-events: none;
    }
    .zone.selected text {
      fill: var(--primary-text-color);
      font-weight: 500;
    }
    .target circle {
      fill: var(--accent-color, #ff9800);
      stroke: var(--card-background-color, #fff);
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
    .target text {
      fill: var(--text-accent-color, #fff);
      font-weight: 700;
    }
    .readout {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      margin-top: 4px;
      font-size: 0.85em;
      font-variant-numeric: tabular-nums;
      color: var(--secondary-text-color);
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      margin-top: 8px;
      font-size: 0.85em;
      color: var(--secondary-text-color);
    }
    .swatch {
      display: inline-block;
      width: 16px;
      height: 10px;
      margin-right: 6px;
      vertical-align: middle;
    }
    .swatch.area {
      background: color-mix(in srgb, var(--primary-color) 7%, transparent);
      border: 1.5px solid color-mix(in srgb, var(--primary-color) 45%, transparent);
    }
    .floor-plan {
      fill: none;
      stroke: var(--primary-text-color);
      stroke-width: 2.5;
      stroke-linejoin: round;
    }
    .legend label.toggle {
      display: inline-flex;
      align-items: center;
      cursor: pointer;
    }
    .legend label.toggle input {
      margin: 0 4px 0 0;
    }
    .swatch.floor-plan {
      height: 0;
      border-top: 2.5px solid var(--primary-text-color);
    }
    .swatch.target {
      width: 10px;
      border-radius: 50%;
      background: var(--accent-color, #ff9800);
    }
    .swatch.zone {
      background: color-mix(in srgb, var(--green-color, #4caf50) 20%, transparent);
      border: 2px solid var(--green-color, #4caf50);
    }
    .swatch.occupied {
      background: color-mix(in srgb, var(--yellow-color, #ffeb3b) 45%, transparent);
      border: 1px solid var(--secondary-text-color);
    }
    .swatch.bounds {
      border: 1px dashed var(--secondary-text-color);
    }
  `;
}

if (!customElements.get("ld2450-zone-map")) {
  customElements.define("ld2450-zone-map", Ld2450ZoneMap);
}
