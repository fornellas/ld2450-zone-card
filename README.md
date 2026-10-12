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
- **Floor plan:** an outline of the room you draw yourself.
- **Zones:** the selected zone is highlighted, the others are dashed, and occupied zones (from their presence
  sensors) are filled.
- **Targets:** live positions of up to three people, also listed under the map.
- **Toggle anything** by clicking it in the legend: tracking range, floor plan, selected zone, occupied and targets.
  The choice is saved per user.
- **Fits what's shown:** the map zooms to the visible items, targets and trail.

### Editing zones

- **Draw on the map:** click to add a point, click an edge to insert one, drag points to move them, and double-click
  or use **Delete point** to remove them. Works with touch on phones.
- **Type coordinates:** the selected point's X and Y can be typed in.
- **Snapping:** to a grid with a configurable step, and to nearby points of the floor plan and other zones.
- **Undo and redo**, with buttons or Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y). A whole drag is one step.
- **Clear and Revert:** start over, or go back to what's on the device.
- **Checks before saving:** too few or too many points (the firmware takes 3 to 23) are errors. Points outside the
  tracking range are warnings.
- **Save with confirmation:** the card writes the zone and waits for the device to report it back. If Home Assistant
  or the device rejects it, for example because a point is outside the area the device accepts, the card says so and
  keeps your drawing to fix and save again. An empty zone disables it.

### Trail and automatic zones

- **Trail:** while on, every position where a target is seen is kept (the last 7,000 per device) and drawn on the map,
  so you can see where people actually walk, sit or stand. It's off on every page load. It only records positions
  whose X and Y were updated together, from the same radar frame, so it doesn't mix the X of one moment with the Y
  of another.
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

### ESPHome configuration

The device needs polygon zones: a text entity per zone under `text: - platform: ld2450`, each with a presence sensor
under `binary_sensor: - platform: ld2450`. To show targets, add the `x` and `y` sensors of `target_1`…`target_3`
under `sensor: - platform: ld2450`. See the
[polygon zones documentation](https://github.com/esphome/esphome.io/pull/7632) for all options.

A full example, with two zones and three targets:

```yaml
# Polygon zones aren't in an ESPHome release yet: take the ld2450 component from its pull request
external_components:
  - source: github://pr#20154
    components: [ld2450]

uart:
  id: uart_ld2450
  # The LD2450's TX goes to the ESP's RX, and its RX to the ESP's TX. Use your board's pins.
  tx_pin: GPIO17
  rx_pin: GPIO16
  baud_rate: 256000
  parity: NONE
  stop_bits: 1

ld2450:
  id: ld2450_radar
  uart_id: uart_ld2450

# One text entity per zone, holding its polygon. The card draws and saves them.
text:
  - platform: ld2450
    ld2450_id: ld2450_radar
    polygon_zones:
      - id: couch_zone
        name: Couch Zone Polygon
      - id: desk_zone
        name: Desk Zone Polygon

# One presence sensor per zone. "<zone name> Occupied" pairs with its zone in the card automatically.
binary_sensor:
  - platform: ld2450
    ld2450_id: ld2450_radar
    polygon_zones:
      - polygon_zone_id: couch_zone
        name: Couch Occupied
      - polygon_zone_id: desk_zone
        name: Desk Occupied

# Target positions, drawn live on the card's map. Keep their default icons and units, so the card finds them, and
# don't add filters that change their values.
sensor:
  - platform: ld2450
    ld2450_id: ld2450_radar
    target_1:
      x:
        name: Target-1 X
      y:
        name: Target-1 Y
    target_2:
      x:
        name: Target-2 X
      y:
        name: Target-2 Y
    target_3:
      x:
        name: Target-3 X
      y:
        name: Target-3 Y
```

Name each presence sensor `<zone name> Occupied` (for example `Couch` and `Couch Occupied`) and the card pairs them
automatically. Other names are paired by the words they share, and a zone that matches more than one sensor equally
well is left for you to pair in the [configuration](#configuration).

Zones are checked on the device in the radar's own coordinates, and target sensors are drawn on the same map, so don't
change their values with filters (for example multiplying X by -1 for an upside down radar). Use the card's **Upside
down** option instead.

### Configuration

Auto-discovery depends on the default configuration. If you change anything, you'll need to manually specify the
entities. Discovery relies on these defaults:

- **Target X/Y sensors:** `sensor` entities on the same device as the zones, with `device_class: distance`, a length
  unit (mm by default, or any length unit Home Assistant shows them in), and icons `mdi:alpha-x-box-outline` (X) and
  `mdi:alpha-y-box-outline` (Y). The X and Y of a target are paired by their names, which must differ only by "X"
  and "Y" (for example `Target-1 X` and `Target-1 Y`).
- **Presence sensors:** `binary_sensor` entities on the same device as the zones, with `device_class: occupancy` and
  no icon, paired with their zones by name (see above).

Changing an icon, device class or unit in your ESPHome YAML or in Home Assistant hides that entity from discovery.
Name it in the `targets:` (target X/Y sensors) or `zones:` (presence sensors) option instead.

Every option can be set in the card's visual editor, or in YAML. They're all optional, and override automatic
discovery:

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
