# LD2450 Zone Card

A Home Assistant dashboard card to draw polygon zones for [ESPHome](https://esphome.io/) LD2450 radars. Zones are
evaluated on the device.

> Work in progress. It requires ESPHome polygon zone support from
> [esphome/esphome#20154](https://github.com/esphome/esphome/pull/20154).

<img src="https://raw.githubusercontent.com/fornellas/ld2450-zone-card/main/docs/screenshot.png" alt="The card editing an occupied zone, with the floor plan, the radar and a target" width="400">

## Features

### Finding your radars

- **Automatic discovery.** Every ESPHome device with LD2450 polygon zones is found and listed; pick the device and the
  zone to edit at the top. Each zone's presence sensor and the target X/Y sensors are found too.
- **Names follow Home Assistant.** Devices are named with your _Entity ID format_ (Settings → System), for example
  area and device.
- **Overrides.** If anything isn't found automatically, the card config can name the entities (see
  [Configuration](#configuration)).
- **Offline devices** are marked, and changes can't be saved until they're back.

### The map

- **Top-down view** of the room, with a grid in metric or imperial units (chosen per user).
- **Tracking range:** where the radar can see, from the measured plot in the HLK-LD2450 manual.
- **Zone point limits:** the area the firmware accepts for zone points.
- **Floor plan:** an outline of the room you draw yourself.
- **Zones:** the selected zone is highlighted, the others are dashed, and occupied zones (from their presence
  sensors) are filled.
- **Targets:** live positions of up to three people, also listed under the map.
- **Toggle anything** by clicking it in the legend: tracking range, zone point limits, floor plan, selected zone,
  occupied and targets. The choice is saved per user.
- **Fits what's shown:** the map zooms to the visible items, targets and trail.

### Editing zones

- **Draw on the map:** click to add a point, click an edge to insert one, drag points to move them, and double-click
  or use **Delete point** to remove them. Works with touch on phones.
- **Type coordinates:** the selected point's X and Y can be typed in.
- **Snapping:** to a grid with a configurable step, and to nearby points of the floor plan and other zones.
- **Undo and redo**, with buttons or Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y). A whole drag is one step.
- **Clear and Revert:** start over, or go back to what's on the device.
- **Checks before saving:** too few or too many points (the firmware takes 3 to 23), and points outside the zone point
  limits, are errors. Points outside the tracking range are warnings.
- **Save with confirmation:** the card writes the zone and waits for the device to report it back. If Home Assistant
  or the device rejects it, the card says so and keeps your drawing to fix and save again. An empty zone disables it.

### Trail and automatic zones

- **Trail:** while on, every position where a target is seen is kept (the last 7,000 per device) and drawn on the map,
  so you can see where people actually walk, sit or stand. It's off on every page load.
- **Fit zone to trail:** turns the trail into a zone around all its points, keeping a margin you choose to each. It's
  a normal edit, so it can be undone and adjusted before saving.

### Radar position

- **Upside down:** mirrors left and right, for radars mounted upside down.
- **Rotation and X/Y position:** place the radar in the room, so the map, targets, zones and floor plan show in room
  coordinates. Zones are still saved to the device in its own coordinates.
- Shared by all users; only administrators can change it.

### Floor plan

- Pick **Floor plan** in the zone list to draw the room's outline, with the same tools as zones.
- It moves with the radar position, and is shared by all users; only administrators can save it.

### Where settings are kept

- **Per user** (HA user data): units, map toggles, snapping, and the trail margin.
- **Shared** (HA system data, Home Assistant 2025.12 or later): radar positions and floor plans.

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

The device needs polygon zones in its ESPHome configuration: zones under `text: - platform: ld2450` →
`polygon_zones`, each with a presence sensor under `binary_sensor: - platform: ld2450` → `polygon_zones`. Show the
targets with `target_1`…`target_3` `x` and `y` sensors under `sensor: - platform: ld2450`.

Zones are checked on the device in the radar's own coordinates, and target sensors are drawn on the same map, so don't
change their values with filters (for example multiplying X by -1 for an upside down radar). Use the card's **Upside
down** option instead.

### Configuration

Every option is optional, and overrides automatic discovery:

```yaml
type: custom:ld2450-zone-card
title: Living room radar # card title
device_id: 0123456789abcdef # only show this device
targets: # the target X/Y sensors
  - x: sensor.living_room_target_1_x
    y: sensor.living_room_target_1_y
zones: # pair a zone with its presence sensor
  - polygon: text.living_room_couch_zone
    presence: binary_sensor.living_room_couch_occupied
```

## Development

```sh
npm install
npm run watch   # rebuilds dist/ld2450-zone-card.js on changes
npm run check   # typecheck, format check, tests and build
```

To try a build, copy `dist/ld2450-zone-card.js` to `/config/www/` and add the resource as in the manual installation.
Bump `?v=` in the resource URL or clear the browser cache to load a new build.

Releases: push a tag such as `v0.1.0` (`git tag v0.1.0 && git push origin v0.1.0`). The release workflow checks and
builds the card, then creates the GitHub release with `ld2450-zone-card.js` attached, which HACS installs. Tags with a
`-`, such as `v0.1.0-beta.1`, become pre-releases.
