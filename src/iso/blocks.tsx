import type { ReactElement } from 'react';
import { CATEGORY_INFO, KIND_INFO } from '../model/catalog';
import type { ComponentKind, Lifecycle } from '../model/types';
import { mix, shade } from '../model/util';
import type { Projector } from './camera';

const r1 = (n: number) => Math.round(n * 10) / 10;
const pt = ([x, y]: [number, number]) => `${r1(x)} ${r1(y)}`;

export function blockColor(kind: ComponentKind, lifecycle?: Lifecycle): string {
  const base = CATEGORY_INFO[KIND_INFO[kind].category].color;
  return lifecycle === 'retiring' ? mix(base, '#9aa0a8', 0.65) : base;
}

export const gradientId = (color: string) => `cyl-${color.replace('#', '')}`;

/** Horizontal gradient that makes a cylinder body read as round. */
export function CylinderGradient({ color }: { color: string }) {
  return (
    <linearGradient id={gradientId(color)} x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stopColor={shade(color, 0.08)} />
      <stop offset="0.35" stopColor={shade(color, 0.02)} />
      <stop offset="1" stopColor={shade(color, -0.32)} />
    </linearGradient>
  );
}

function sideColor(base: string, light: number): string {
  return shade(base, -0.03 - 0.22 * ((light + 1) / 2));
}

function boxFaces(
  key: string,
  cx: number,
  cy: number,
  w: number,
  d: number,
  z0: number,
  z1: number,
  base: string,
  proj: Projector,
  seams: number,
): ReactElement[] {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - d / 2;
  const y1 = cy + d / 2;
  const edge = shade(base, -0.5);
  const sides: [number, number, [number, number], [number, number]][] = [
    [-1, 0, [x0, y1], [x0, y0]],
    [1, 0, [x1, y0], [x1, y1]],
    [0, -1, [x0, y0], [x1, y0]],
    [0, 1, [x1, y1], [x0, y1]],
  ];
  const out: ReactElement[] = [];
  for (const [nx, ny, a, b] of sides) {
    if (proj.facing(nx, ny) <= 1e-6) continue;
    const d1 = `M${pt(proj.p(a[0], a[1], z0))}L${pt(proj.p(b[0], b[1], z0))}L${pt(proj.p(b[0], b[1], z1))}L${pt(proj.p(a[0], a[1], z1))}Z`;
    out.push(<path key={`${key}s${nx}${ny}`} d={d1} fill={sideColor(base, proj.light(nx, ny))} stroke={edge} strokeWidth={0.5} strokeLinejoin="round" />);
    for (let k = 1; k < seams; k++) {
      const z = z0 + ((z1 - z0) * k) / seams;
      out.push(
        <path
          key={`${key}m${nx}${ny}${k}`}
          d={`M${pt(proj.p(a[0], a[1], z))}L${pt(proj.p(b[0], b[1], z))}`}
          stroke={shade(base, -0.42)}
          strokeWidth={0.7}
          opacity={0.7}
        />,
      );
    }
  }
  const top = `M${pt(proj.p(x0, y0, z1))}L${pt(proj.p(x1, y0, z1))}L${pt(proj.p(x1, y1, z1))}L${pt(proj.p(x0, y1, z1))}Z`;
  out.push(<path key={`${key}t`} d={top} fill={shade(base, 0.24)} stroke={edge} strokeWidth={0.5} strokeLinejoin="round" />);
  return out;
}

function cylinder(
  key: string,
  cx: number,
  cy: number,
  r: number,
  z0: number,
  z1: number,
  base: string,
  proj: Projector,
  seams: number,
  gradient: boolean,
): ReactElement[] {
  const [rx, ry] = proj.ellipse(r);
  const [bx, by] = proj.p(cx, cy, z0);
  const [tx, ty] = proj.p(cx, cy, z1);
  const edge = shade(base, -0.5);
  const out: ReactElement[] = [];
  if (Math.abs(by - ty) > 0.01) {
    out.push(
      <path
        key={`${key}b`}
        d={`M${r1(bx - rx)} ${r1(by)}L${r1(tx - rx)} ${r1(ty)}L${r1(tx + rx)} ${r1(ty)}L${r1(bx + rx)} ${r1(by)}A${r1(rx)} ${r1(ry)} 0 0 1 ${r1(bx - rx)} ${r1(by)}Z`}
        fill={gradient ? `url(#${gradientId(base)})` : shade(base, -0.1)}
        stroke={edge}
        strokeWidth={0.5}
      />,
    );
    for (let k = 1; k < seams; k++) {
      const [, sy] = proj.p(cx, cy, z0 + ((z1 - z0) * k) / seams);
      out.push(
        <path
          key={`${key}m${k}`}
          d={`M${r1(bx - rx)} ${r1(sy)}A${r1(rx)} ${r1(ry)} 0 0 0 ${r1(bx + rx)} ${r1(sy)}`}
          fill="none"
          stroke={shade(base, -0.42)}
          strokeWidth={0.7}
          opacity={0.7}
        />,
      );
    }
  }
  out.push(<ellipse key={`${key}t`} cx={r1(tx)} cy={r1(ty)} rx={r1(rx)} ry={Math.max(0.1, r1(ry))} fill={shade(base, 0.24)} stroke={edge} strokeWidth={0.5} />);
  return out;
}

const STUD_LAYOUTS: [number, number][][] = [
  [],
  [[0, 0]],
  [
    [-0.15, 0],
    [0.15, 0],
  ],
  [
    [-0.15, -0.13],
    [0.15, -0.13],
    [0, 0.14],
  ],
  [
    [-0.15, -0.15],
    [0.15, -0.15],
    [-0.15, 0.15],
    [0.15, 0.15],
  ],
];

/**
 * One piece: body shaped by its kind, seams for replicas, and a stud for each
 * interface it provides. Pieces that provide nothing are smooth tiles.
 */
export function renderBlock(
  key: string,
  kind: ComponentKind,
  replicas: number,
  cell: { x: number; y: number },
  proj: Projector,
  opts: { color?: string; studs?: boolean; gradient?: boolean } = {},
): ReactElement[] {
  const info = KIND_INFO[kind];
  const g = info.geometry;
  const base = opts.color ?? blockColor(kind);
  const cx = cell.x + 0.5;
  const cy = cell.y + 0.5;
  const seams = Math.min(Math.max(1, replicas), 4);
  const out: ReactElement[] = [];
  let topZ = g.h;
  let topW = g.w;
  let topD = g.d;
  if (g.shape === 'box') {
    out.push(...boxFaces(`${key}a`, cx, cy, g.w, g.d, 0, g.h, base, proj, seams));
    if (g.cap) {
      out.push(...boxFaces(`${key}c`, cx, cy, g.cap.w, g.cap.d, g.h, g.h + g.cap.h, shade(base, -0.06), proj, 1));
      topZ = g.h + g.cap.h;
      topW = g.cap.w;
      topD = g.cap.d;
    }
  } else {
    out.push(...cylinder(`${key}a`, cx, cy, g.w / 2, 0, g.h, base, proj, seams, opts.gradient !== false));
  }

  const studCount = Math.min(info.provides.length, 4);
  if (opts.studs !== false && studCount > 0) {
    const scale = Math.min(topW, topD) / 0.72;
    const studs = STUD_LAYOUTS[studCount]
      .map(([dx, dy]) => ({ x: cx + dx * scale, y: cy + dy * scale }))
      .sort((a, b) => proj.depth(a.x, a.y) - proj.depth(b.x, b.y));
    studs.forEach((s, i) => {
      out.push(...cylinder(`${key}k${i}`, s.x, s.y, 0.075 * Math.min(1.2, scale), topZ, topZ + 0.07, shade(base, 0.12), proj, 1, false));
    });
  }
  return out;
}

/** Height of a piece's top surface (for labels and joints). */
export function blockTop(kind: ComponentKind): number {
  const g = KIND_INFO[kind].geometry;
  return g.h + (g.cap?.h ?? 0);
}
