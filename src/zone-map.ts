import { LitElement, css, html, svg } from "lit";
import { DETECTION_AREA, FIRMWARE_BOUNDS } from "./detection-area";
import type { Point } from "./polygon";
import { DEFAULT_MOUNT, type Mount, toRoom } from "./transform";
import { type Units, formatGridLabel, gridSpacing } from "./units";

const RADAR_WIDTH = 440;
const RADAR_DEPTH = 150;
const HEADING_LENGTH = 700;

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

/** SVG y grows downwards, room y grows away from the viewer. */
const pointsAttr = (points: Point[]) => points.map((p) => `${p.x},${-p.y}`).join(" ");

/** Multiples of step within [min, max]. */
function steps(min: number, max: number, step: number): number[] {
  const values: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) values.push(v);
  return values;
}

/** Top-down map of the room in room coordinates (mm), with the radar and where it can see. */
export class Ld2450ZoneMap extends LitElement {
  static override properties = {
    mount: { attribute: false },
    units: { attribute: false },
  };

  mount: Mount = DEFAULT_MOUNT;
  units: Units = "metric";

  override render() {
    const area = DETECTION_AREA.map((p) => toRoom(p, this.mount));
    const bounds = FIRMWARE_BOUNDS.map((p) => toRoom(p, this.mount));
    const content = extentOf([...area, ...bounds]);
    const size = Math.max(content.maxX - content.minX, content.maxY - content.minY);
    const font = size * 0.025;
    // Room for the axis labels on the left and bottom
    const view: Extent = {
      minX: content.minX - font * 4,
      maxX: content.maxX + font,
      minY: content.minY - font * 2,
      maxY: content.maxY + font,
    };
    const viewBox = `${view.minX} ${-view.maxY} ${view.maxX - view.minX} ${view.maxY - view.minY}`;

    return html`
      <svg viewBox=${viewBox} role="img" aria-label="Radar map" style="--font: ${font}px">
        ${this._renderGrid(view, font)}
        <polygon class="bounds" points=${pointsAttr(bounds)}></polygon>
        <polygon class="area" points=${pointsAttr(area)}></polygon>
        ${this._renderRadar()}
      </svg>
      <div class="legend">
        <span><i class="swatch area"></i>Tracking range (datasheet)</span>
        <span><i class="swatch bounds"></i>Zone point limits</span>
      </div>
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
      fill-opacity: 0.15;
      stroke: var(--primary-color);
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
      background: color-mix(in srgb, var(--primary-color) 15%, transparent);
      border: 1.5px solid var(--primary-color);
    }
    .swatch.bounds {
      border: 1px dashed var(--secondary-text-color);
    }
  `;
}

if (!customElements.get("ld2450-zone-map")) {
  customElements.define("ld2450-zone-map", Ld2450ZoneMap);
}
