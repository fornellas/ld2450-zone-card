import { LitElement, css, html, nothing } from "lit";
import { DEFAULT_MOUNT, type Mount } from "./transform";
import { type Units, fromInputValue, inputUnit, toInputValue } from "./units";

const MAX_OFFSET = 50000;

/** Controls for how the radar is mounted. Fires "mount-changed" with the new mount in the detail. */
export class Ld2450MountEditor extends LitElement {
  static override properties = {
    mount: { attribute: false },
    units: { attribute: false },
    disabled: { type: Boolean },
  };

  mount: Mount = DEFAULT_MOUNT;
  units: Units = "metric";
  disabled = false;

  override render() {
    const unit = inputUnit(this.units);
    const step = this.units === "metric" ? 0.01 : 0.1;
    const maxOffset = toInputValue(MAX_OFFSET, this.units);
    return html`
      <label class="check">
        <input
          type="checkbox"
          .checked=${this.mount.upsideDown}
          ?disabled=${this.disabled}
          @change=${(ev: Event) => this._change({ upsideDown: (ev.target as HTMLInputElement).checked })}
        />
        Upside down
      </label>
      <div class="row">
        <label title="Counter-clockwise, in degrees">
          Rotation (° CCW)
          <input
            type="number"
            min="-180"
            max="180"
            step="1"
            .value=${String(this.mount.rotation)}
            ?disabled=${this.disabled}
            @change=${this._rotationChanged}
          />
        </label>
        <label>
          Radar X (${unit})
          <input
            type="number"
            min=${-maxOffset}
            max=${maxOffset}
            step=${step}
            .value=${String(toInputValue(this.mount.offset.x, this.units))}
            ?disabled=${this.disabled}
            @change=${(ev: Event) => this._offsetChanged(ev, "x")}
          />
        </label>
        <label>
          Radar Y (${unit})
          <input
            type="number"
            min=${-maxOffset}
            max=${maxOffset}
            step=${step}
            .value=${String(toInputValue(this.mount.offset.y, this.units))}
            ?disabled=${this.disabled}
            @change=${(ev: Event) => this._offsetChanged(ev, "y")}
          />
        </label>
      </div>
      ${this.disabled ? html`<p class="note">Only administrators can change the radar position.</p>` : nothing}
    `;
  }

  private _rotationChanged(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const value = Number(input.value);
    if (input.value === "" || !Number.isFinite(value)) {
      input.value = String(this.mount.rotation);
      return;
    }
    // Keep it in (-180, 180]
    let rotation = ((Math.round(value) % 360) + 360) % 360;
    if (rotation > 180) rotation -= 360;
    input.value = String(rotation);
    this._change({ rotation });
  }

  private _offsetChanged(ev: Event, axis: "x" | "y"): void {
    const input = ev.target as HTMLInputElement;
    const value = Number(input.value);
    if (input.value === "" || !Number.isFinite(value)) {
      input.value = String(toInputValue(this.mount.offset[axis], this.units));
      return;
    }
    const mm = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, fromInputValue(value, this.units)));
    this._change({ offset: { ...this.mount.offset, [axis]: mm } });
  }

  private _change(change: Partial<Mount>): void {
    this.dispatchEvent(
      new CustomEvent<Mount>("mount-changed", { detail: { ...this.mount, ...change }, bubbles: true, composed: true }),
    );
  }

  static override styles = css`
    .row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-top: 8px;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 0.85em;
      color: var(--secondary-text-color);
    }
    label.check {
      flex-direction: row;
      align-items: center;
      font-size: 1em;
      color: var(--primary-text-color);
    }
    input[type="number"] {
      padding: 6px 8px;
      font: inherit;
      font-size: 1.1em;
      color: var(--primary-text-color);
      background: var(--card-background-color);
      border: 1px solid var(--divider-color);
      border-radius: 4px;
      min-width: 0;
    }
    .note {
      margin: 8px 0 0;
      font-size: 0.85em;
      color: var(--secondary-text-color);
    }
  `;
}

if (!customElements.get("ld2450-mount-editor")) {
  customElements.define("ld2450-mount-editor", Ld2450MountEditor);
}
