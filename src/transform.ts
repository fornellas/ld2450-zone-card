// Radar coordinates (what the device stores) <-> room coordinates (what the user sees).
//
// Room coordinates are seen from above, with +y ahead and +x to the right, like the radar's own coordinates.
// Inverting x mirrors left and right, for example for a radar mounted upside down.

import type { Point } from "./polygon";

/** How the radar is mounted in the room. */
export interface Mount {
  /** Mirror the radar's x axis, for example when it's mounted upside down. */
  invertX: boolean;
  /** Counter-clockwise rotation of the radar in the room, in degrees. 0 faces +y. */
  rotation: number;
  /** Where the radar is in the room, in mm. */
  offset: Point;
}

export const DEFAULT_MOUNT: Mount = { invertX: false, rotation: 0, offset: { x: 0, y: 0 } };

export function toRoom(p: Point, mount: Mount): Point {
  const x = mount.invertX ? -p.x : p.x;
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
  return { x: mount.invertX ? -x : x, y: -dx * sin + dy * cos };
}
