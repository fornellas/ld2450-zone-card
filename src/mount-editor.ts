import { LitElement, css, html, nothing } from "lit";
import { DEFAULT_MOUNT, type Mount } from "./transform";
import { type Units, fromInputValue, inputUnit, toInputValue } from "./units";

const MAX_OFFSET = 50000;

/** Controls for how the radar is mounted. Fires "mount-changed" with the new mount in the detail. */
type Field = "rotation" | "x" | "y";

/** Keep a rotation in (-180, 180]. */
function normalizeRotation(value: number): number {
  const rotation = ((Math.round(value) % 360) + 360) % 360;
  return rotation > 180 ? rotation - 360 : rotation;
}

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

  // What the user is typing, so re-renders don't reformat a number while it's being edited
  private _drafts: Partial<Record<Field, string>> = {};

  override render() {
    const unit = inputUnit(this.units);
    const step = this.units === "metric" ? 0.01 : 0.1;
    const maxOffset = toInputValue(MAX_OFFSET, this.units);
    return html`
      <label class="check" title="Mirror left and right, for example when the radar is mounted upside down">
        <input
          type="checkbox"
          .checked=${this.mount.invertX}
          ?disabled=${this.disabled}
          @change=${(ev: Event) => this._change({ invertX: (ev.target as HTMLInputElement).checked })}
        />
        Invert X <span class="hint">(mirror left and right)</span>
      </label>
      <div class="row">
        ${this._renderNumber("rotation", "Rotation (° CCW)", -180, 180, 1)}
        ${this._renderNumber("x", `Radar X (${unit})`, -maxOffset, maxOffset, step)}
        ${this._renderNumber("y", `Radar Y (${unit})`, -maxOffset, maxOffset, step)}
      </div>
      ${this.disabled ? html`<p class="note">Only administrators can change the radar position.</p>` : nothing}
    `;
  }

  private _renderNumber(field: Field, label: string, min: number, max: number, step: number) {
    return html`
      <label>
        ${label}
        <input
          type="number"
          min=${min}
          max=${max}
          step=${step}
          .value=${this._drafts[field] ?? this._format(field)}
          ?disabled=${this.disabled}
          @input=${(ev: Event) => this._input(field, ev.target as HTMLInputElement)}
          @change=${(ev: Event) => this._commit(field, ev.target as HTMLInputElement)}
        />
      </label>
    `;
  }

  private _format(field: Field): string {
    if (field === "rotation") return String(this.mount.rotation);
    return String(toInputValue(this.mount.offset[field], this.units));
  }

  /** The mount change for a value typed in a field, or undefined if it isn't a number. */
  private _parse(field: Field, text: string): Partial<Mount> | undefined {
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value)) return undefined;
    if (field === "rotation") return { rotation: normalizeRotation(value) };
    const mm = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, fromInputValue(value, this.units)));
    return { offset: { ...this.mount.offset, [field]: mm } };
  }

  /** Every keystroke, arrow and scroll: update the map right away. */
  private _input(field: Field, input: HTMLInputElement): void {
    const change = this._parse(field, input.value);
    // Partial numbers such as "1." read as "" in number inputs; leave them alone until they're complete
    if (change === undefined) return;
    this._drafts = { ...this._drafts, [field]: input.value };
    this._change(change);
  }

  /** Enter or leaving the field: show the value in use, normalized. */
  private _commit(field: Field, input: HTMLInputElement): void {
    const change = this._parse(field, input.value);
    this._drafts = { ...this._drafts, [field]: undefined };
    if (change === undefined) {
      // Not a number: go back to the value in use. The render wouldn't, as its value hasn't changed
      input.value = this._format(field);
    } else {
      this._change(change);
    }
    this.requestUpdate();
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
      /* Labels may wrap on narrow screens; keep the inputs lined up */
      align-items: end;
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
      flex-wrap: wrap;
      align-items: center;
      font-size: 1em;
      color: var(--primary-text-color);
    }
    .hint {
      font-size: 0.85em;
      color: var(--secondary-text-color);
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
