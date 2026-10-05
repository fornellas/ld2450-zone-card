// Metric or imperial lengths. Everything is stored in mm.

export type Units = "metric" | "imperial";

const MM_PER_FOOT = 304.8;

/** Grid size until the user sets one, in mm: 25 cm or 1 ft. */
export const DEFAULT_GRID: Record<Units, number> = { metric: 250, imperial: MM_PER_FOOT };

/** Grid sizes the user can set, in mm. */
export const MIN_GRID = 10;
export const MAX_GRID = 5000;

// Most grid lines and labels across the map, so a small grid size stays readable
const MAX_LINES = 80;
const MAX_LABELS = 14;
const MULTIPLES = [1, 2, 4, 5, 10, 20, 40, 50, 100, 200, 400, 500, 1000];

export interface GridSpacing {
  /** Distance between grid lines, in mm. */
  minor: number;
  /** Distance between labelled grid lines, in mm. */
  major: number;
}

/** Whether a length reads well as a label: 1, 2, 2.5 or 5 times a power of ten, in metres or feet. */
function isRound(mm: number, units: Units): boolean {
  const value = mm / (units === "metric" ? 1000 : MM_PER_FOOT);
  const mantissa = value / 10 ** Math.floor(Math.log10(value) + 1e-9);
  return [1, 2, 2.5, 5, 10].some((m) => Math.abs(mantissa - m) < 1e-6);
}

/**
 * Grid lines for a grid size over a map of the given size (mm). Lines are skipped when they'd be too dense, and
 * labels go on round values when the grid allows it.
 */
export function gridSpacing(grid: number, size: number, units: Units): GridSpacing {
  const last = MULTIPLES[MULTIPLES.length - 1];
  const minor = grid * (MULTIPLES.find((m) => size / (grid * m) <= MAX_LINES) ?? last);
  const fits = MULTIPLES.filter((m) => size / (minor * m) <= MAX_LABELS);
  const major = minor * (fits.find((m) => isRound(minor * m, units)) ?? fits[0] ?? last);
  return { minor, major };
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
