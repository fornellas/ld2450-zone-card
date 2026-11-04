// Ask a device for every target position while a card is visible, by pressing its "xy_unfiltered" button.
//
// The button makes the "xy" text sensors skip their filters for a while (10 s in ESPHome), restarting the time on
// each press. Pressing it again every few seconds keeps them unfiltered for as long as someone looks, and when
// nobody does (the dashboard is closed, the network is gone) the device goes back to its filters by itself. Nothing
// here ever needs to turn it off. Several cards, tabs, browsers and users can press the same button independently.

import type { HomeAssistant } from "./ha-types";

// A third of the time the device stays unfiltered after a press, so a missed press doesn't let the filters back in
export const PRESS_INTERVAL_MS = 3000;

interface Presser {
  /** The users of the button on this page. One timer presses it for all of them. */
  users: Set<() => HomeAssistant | undefined>;
  timer: ReturnType<typeof setInterval>;
  warned: boolean;
}

const pressers = new Map<string, Presser>();

function press(button: string, presser: Presser): void {
  const hass = [...presser.users].map((user) => user()).find((h) => h !== undefined);
  if (hass === undefined) return;
  hass.callService("button", "press", {}, { entity_id: button }).then(
    () => (presser.warned = false),
    (err) => {
      if (!presser.warned) console.warn(`ld2450-zone-card: could not press ${button}`, err);
      presser.warned = true;
    },
  );
}

/**
 * Keep the button's device unfiltered until the returned function is called. Presses it now, and every
 * PRESS_INTERVAL_MS, once for all the users of the same button on the page. `getHass` gives the current hass object.
 */
export function holdUnfiltered(button: string, getHass: () => HomeAssistant | undefined): () => void {
  let presser = pressers.get(button);
  if (presser === undefined) {
    const created: Presser = {
      users: new Set(),
      timer: setInterval(() => press(button, created), PRESS_INTERVAL_MS),
      warned: false,
    };
    presser = created;
    pressers.set(button, created);
    created.users.add(getHass);
    press(button, created);
  } else {
    presser.users.add(getHass);
  }
  const held = presser;
  return () => {
    held.users.delete(getHass);
    if (held.users.size === 0) {
      clearInterval(held.timer);
      pressers.delete(button);
    }
  };
}
