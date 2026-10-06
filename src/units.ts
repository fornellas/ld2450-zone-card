// Metric or imperial lengths. Everything is stored in mm.

export type Units = "metric" | "imperial";

const MM_PER_FOOT = 304.8;

/** Snap step until the user sets one, in mm: 10 cm or 6 in. */
export const DEFAULT_SNAP: Record<Units, number> = { metric: 100, imperial: MM_PER_FOOT / 2 };

/** Snap steps the user can set, in mm. */
export const MIN_SNAP = 10;
export const MAX_SNAP = 5000;

/** Margin around the trail when fitting a zone to it, until the user sets one, in mm: 30 cm or 1 ft. */
export const DEFAULT_TRAIL_MARGIN: Record<Units, number> = { metric: 300, imperial: MM_PER_FOOT };
export const MAX_TRAIL_MARGIN = 2000;

export interface GridSpacing {
  /** Distance between grid lines, in mm. */
  minor: number;
  /** Distance between labelled grid lines, in mm. */
  major: number;
}

export function gridSpacing(units: Units): GridSpacing {
  return units === "metric" ? { minor: 500, major: 1000 } : { minor: MM_PER_FOOT, major: 5 * MM_PER_FOOT };
}

/** A grid label: "2 m", "0.75 m" or "10 ft". */
export function formatGridLabel(mm: number, units: Units): string {
  // "+ 0" turns -0 into 0
  return units === "metric"
    ? `${Number((mm / 1000).toFixed(2)) + 0} m`
    : `${Number((mm / MM_PER_FOOT).toFixed(1)) + 0} ft`;
}

/** A length for display: "1.25 m" or "4′ 1″". */
export function formatLength(mm: number, units: Units): string {
  if (units === "metric") return `${(mm / 1000).toFixed(2)} m`;
  const totalInches = Math.round(Math.abs(mm) / 25.4);
  const sign = mm < 0 && totalInches > 0 ? "-" : "";
  return `${sign}${Math.floor(totalInches / 12)}′ ${totalInches % 12}″`;
}

/** The units of HA's unit system, used until the user picks some. */
export function defaultUnits(lengthUnit: string | undefined): Units {
  return lengthUnit === "mi" ? "imperial" : "metric";
}

/** The unit of length inputs: metres or feet. */
export function inputUnit(units: Units): string {
  return units === "metric" ? "m" : "ft";
}

/** A length in mm as a value for an input in metres or feet. */
export function toInputValue(mm: number, units: Units): number {
  const value = units === "metric" ? mm / 1000 : mm / MM_PER_FOOT;
  return Math.round(value * 100) / 100;
}

/** A value from an input in metres or feet, in whole mm. */
export function fromInputValue(value: number, units: Units): number {
  return Math.round(units === "metric" ? value * 1000 : value * MM_PER_FOOT);
}
