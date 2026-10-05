// Radar coordinates (what the device stores) <-> room coordinates (what the user sees).
//
// Room coordinates are seen from above, with +y ahead and +x to the right. The radar's own x grows towards its left
// (seen from behind it, as in Fig. 6 of the manual), so it's mirrored, unless inverted, for example for a radar
// mounted upside down.

import type { Point } from "./polygon";

/** How the radar is mounted in the room. */
export interface Mount {
  /** Use the radar's x as-is instead of mirroring it, for example when it's mounted upside down. */
  invertX: boolean;
  /** Counter-clockwise rotation of the radar in the room, in degrees. 0 faces +y. */
  rotation: number;
  /** Where the radar is in the room, in mm. */
  offset: Point;
}

export const DEFAULT_MOUNT: Mount = { invertX: false, rotation: 0, offset: { x: 0, y: 0 } };

export function toRoom(p: Point, mount: Mount): Point {
  const x = mount.invertX ? p.x : -p.x;
  const a = (mount.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return {
    x: x * cos - p.y * sin + mount.offset.x,
    y: x * sin + p.y * cos + mount.offset.y,
  };
}

export function toRadar(p: Point, mount: Mount): Point {
  const dx = p.x - mount.offset.x;
  const dy = p.y - mount.offset.y;
  const a = (mount.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const x = dx * cos + dy * sin;
  return { x: mount.invertX ? x : -x, y: -dx * sin + dy * cos };
}
