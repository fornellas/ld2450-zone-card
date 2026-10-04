import { LitElement, css, html } from "lit";
import type { HomeAssistant, LovelaceCardConfig } from "./ha-types";

declare const __VERSION__: string;

const CARD_TYPE = "ld2450-zone-card";

export interface Ld2450ZoneCardConfig extends LovelaceCardConfig {
  title?: string;
}

export class Ld2450ZoneCard extends LitElement {
  static override properties = {
    hass: { attribute: false },
    _config: { state: true },
  };

  hass?: HomeAssistant;
  private _config?: Ld2450ZoneCardConfig;

  static getStubConfig(): Partial<Ld2450ZoneCardConfig> {
    return {};
  }

  setConfig(config: Ld2450ZoneCardConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this._config = config;
  }

  getCardSize(): number {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  override render() {
    if (!this._config) return html``;
    return html`
      <ha-card .header=${this._config.title ?? "LD2450 Zones"}>
        <div class="card-content">Nothing here yet.</div>
      </ha-card>
    `;
  }

  static override styles = css`
    .card-content {
      color: var(--secondary-text-color);
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
  console.info(
    `%c LD2450-ZONE-CARD %c ${__VERSION__} `,
    "color: white; background: #03a9f4; font-weight: 700",
    "",
  );
}
