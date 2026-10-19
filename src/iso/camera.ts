/** Orthographic camera over the baseplate: azimuth spins around the plate, elevation tilts it. */
export interface Camera {
  az: number;
  el: number;
}

export const VIEWS = {
  iso: { az: 45, el: 32 },
  front: { az: 0, el: 16 },
  top: { az: 0, el: 90 },
} satisfies Record<string, Camera>;
export type ViewName = keyof typeof VIEWS;

/** Size of one grid cell in SVG units. */
export const CELL = 40;

export interface Projector {
  /** World (cell units, z up) → screen (SVG units). */
  p(x: number, y: number, z: number): [number, number];
  /** Distance toward the viewer; larger means drawn later. */
  depth(x: number, y: number): number;
  /** > 0 when a vertical face with outward normal (nx, ny) faces the camera. */
  facing(nx: number, ny: number): number;
  /** Screen-x component of a horizontal normal: −1 lit side … +1 shadow side. */
  light(nx: number, ny: number): number;
  /** Screen radii of a horizontal circle with world radius r. */
  ellipse(r: number): [number, number];
  se: number;
  ce: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

export function makeProjector(cam: Camera, center: { x: number; y: number }, S = CELL): Projector {
  const a = rad(cam.az);
  const e = rad(cam.el);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const se = Math.sin(e);
  const ce = Math.abs(Math.cos(e)) < 1e-6 ? 0 : Math.cos(e);
  return {
    p(x, y, z) {
      const dx = x - center.x;
      const dy = y - center.y;
      const xr = dx * c - dy * s;
      const yr = dx * s + dy * c;
      return [xr * S, yr * S * se - z * S * ce];
    },
    depth(x, y) {
      const dx = x - center.x;
      const dy = y - center.y;
      return dx * s + dy * c;
    },
    facing(nx, ny) {
      return nx * s + ny * c;
    },
    light(nx, ny) {
      return nx * c - ny * s;
    },
    ellipse(r) {
      return [r * S, r * S * se];
    },
    se,
    ce,
  };
}

export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  // Spin the short way round.
  let d = ((b.az - a.az) % 360 + 540) % 360 - 180;
  if (Math.abs(d) < 1e-9) d = 0;
  return { az: a.az + d * t, el: a.el + (b.el - a.el) * t };
}

export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
