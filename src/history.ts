// Past target positions, from the history Home Assistant recorded for the "xy" text sensors.

import type { HomeAssistant } from "./ha-types";
import type { TrackPoint } from "./age-color";
import { parseXY } from "./targets";

/** A state in the compressed format of the history websocket API (minimal_response, no_attributes). */
export interface HistoryState {
  /** The state. */
  s: string;
  /** When it was last updated, in seconds since the epoch. */
  lu?: number;
  /** When it last changed, in seconds since the epoch. */
  lc?: number;
}

/**
 * The positions in the history of the xy sensors, oldest first, mixed across targets by time: each change to a
 * position of a target, not the same one published twice, and nothing for the times it had no target. At most `max`
 * are kept, the most recent ones, and `truncated` says when there were more.
 */
export function historyPoints(
  history: Record<string, HistoryState[]>,
  max: number,
): { points: TrackPoint[]; truncated: boolean } {
  const found: TrackPoint[] = [];
  for (const states of Object.values(history)) {
    let last: string | undefined;
    for (const state of states) {
      if (state.s === last) continue;
      last = state.s;
      const point = parseXY(state.s);
      if (point !== undefined) found.push({ ...point, time: (state.lu ?? state.lc ?? 0) * 1000 });
    }
  }
  // A stable sort, so the points of the same time stay in the order of their targets
  found.sort((a, b) => a.time - b.time);
  return { points: found.slice(-max), truncated: found.length > max };
}

/** Where the targets of the xy sensors were between two times, per Home Assistant's recorder. */
export async function fetchTargetHistory(
  hass: HomeAssistant,
  entityIds: string[],
  start: Date,
  end: Date,
  max: number,
): Promise<{ points: TrackPoint[]; truncated: boolean }> {
  if (entityIds.length === 0) return { points: [], truncated: false };
  const history = await hass.callWS<Record<string, HistoryState[]>>({
    type: "history/history_during_period",
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    entity_ids: entityIds,
    include_start_time_state: true,
    significant_changes_only: false,
    minimal_response: true,
    no_attributes: true,
  });
  return historyPoints(history ?? {}, max);
}

/** A date and time in the local time zone, in the format of a datetime-local input: 2026-11-07T14:30. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
