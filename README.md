# LD2450 Zone Card

A Home Assistant dashboard card to draw polygon zones for [ESPHome](https://esphome.io/) LD2450 radars. Zones are
evaluated on the device.

> Work in progress. It requires ESPHome polygon zone support from
> [esphome/esphome#20154](https://github.com/esphome/esphome/pull/20154).

## Installation

### HACS

1. Open HACS, then the ⋮ menu → **Custom repositories**.
2. Add `https://github.com/fornellas/ld2450-zone-card` with type **Dashboard**.
3. Search for **LD2450 Zone Card**, download it, and reload the browser.

### Manual

1. Download `ld2450-zone-card.js` from the [latest release](https://github.com/fornellas/ld2450-zone-card/releases).
2. Copy it to `/config/www/` in Home Assistant.
3. In **Settings → Dashboards → ⋮ → Resources**, add `/local/ld2450-zone-card.js` as a **JavaScript module**.
4. Reload the browser.

## Usage

Add the card to a dashboard from the card picker (**LD2450 Zone Card**), or with YAML:

```yaml
type: custom:ld2450-zone-card
```

## Development

```sh
npm install
npm run watch   # rebuilds dist/ld2450-zone-card.js on changes
npm run check   # typecheck, format check, tests and build
```

To try a build, copy `dist/ld2450-zone-card.js` to `/config/www/` and add the resource as in the manual installation.
Bump `?v=` in the resource URL or clear the browser cache to load a new build.

Releases: publish a GitHub release with a tag such as `v0.1.0`. The release workflow builds the card and attaches
`ld2450-zone-card.js`, which HACS installs.
