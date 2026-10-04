// The editable polygon text: "x,y;x,y;..." in room coordinates and the selected units (mm or inches).

import type { Point } from "./polygon";
import type { Units } from "./units";

const MM_PER_INCH = 25.4;

export function textUnit(units: Units): string {
  return units === "metric" ? "mm" : "in";
}

function formatNumber(mm: number, units: Units): string {
  // "+ 0" turns -0 into 0
  if (units === "metric") return String(Math.round(mm) + 0);
  return String(Math.round((mm / MM_PER_INCH) * 10) / 10 + 0);
}

export function formatRoomText(points: Point[], units: Units): string {
  return points.map((p) => `${formatNumber(p.x, units)},${formatNumber(p.y, units)}`).join(";");
}

/** Parse polygon text in room coordinates to mm. Returns an error message for text it can't read. */
export function parseRoomText(text: string, units: Units): Point[] | string {
  const scale = units === "metric" ? 1 : MM_PER_INCH;
  const trimmed = text.trim().replace(/;\s*$/, "");
  if (trimmed === "") return [];
  const points: Point[] = [];
  for (const [i, part] of trimmed.split(";").entries()) {
    const coords = part.split(",").map((c) => c.trim());
    const values = coords.map(Number);
    if (coords.length !== 2 || coords.some((c) => c === "") || values.some((v) => !Number.isFinite(v))) {
      return `Point ${i + 1} ("${part.trim()}") should be two numbers, as in "x,y".`;
    }
    points.push({ x: values[0] * scale, y: values[1] * scale });
  }
  return points;
}
