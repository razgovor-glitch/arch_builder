import { memo, useMemo, type ReactElement } from 'react';
import { KIND_INFO, PLATFORM_PROTOCOLS, PROTOCOL_INFO } from '../model/catalog';
import type { ArchComponent, Design } from '../model/types';
import { shade, withAlpha } from '../model/util';
import type { Joint } from '../engine/types';
import { CELL, makeProjector, type Camera } from './camera';
import { CylinderGradient, blockColor, blockTop, renderBlock } from './blocks';

export type LinkMode = 'all' | 'business' | 'none';

export interface IsoSceneProps {
  design: Design;
  camera: Camera;
  joints?: Map<string, Joint>;
  /** Only these components are drawn (null = all). */
  visible?: Set<string> | null;
  /** Newly added pieces, drawn with a glow. */
  highlight?: Set<string> | null;
  highlightLinks?: Set<string> | null;
  focusDomain?: string | null;
  selectedId?: string | null;
  selectedConnectionId?: string | null;
  hoverId?: string | null;
  errorIds?: Set<string> | null;
  links?: LinkMode;
  labels?: 'all' | 'auto' | 'none';
  zoneLabels?: boolean;
  plateStuds?: boolean;
  /** tight: whole plate · stable: constant while spinning · content: frame only what is drawn. */
  fit?: 'tight' | 'stable' | 'content';
  zoom?: number;
  pan?: { x: number; y: number };
  animateNew?: boolean;
  className?: string;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string | null) => void;
  onSelectConnection?: (id: string) => void;
  title?: string;
}

const PLATE_THICKNESS = 0.22;

function IsoSceneImpl(props: IsoSceneProps) {
  const {
    design,
    camera,
    joints,
    visible = null,
    highlight = null,
    highlightLinks = null,
    focusDomain = null,
    selectedId = null,
    selectedConnectionId = null,
    hoverId = null,
    errorIds = null,
    links = 'all',
    labels = 'auto',
    zoneLabels = true,
    plateStuds = true,
    fit = 'tight',
    zoom = 1,
    pan = { x: 0, y: 0 },
    animateNew = false,
    className,
    onHover,
    onSelect,
    onSelectConnection,
    title,
  } = props;

  const { w, h } = design.grid;
  const center = { x: w / 2, y: h / 2 };
  const proj = makeProjector(camera, center);
  const shown = useMemo(
    () => design.components.filter((c) => !visible || visible.has(c.id)),
    [design.components, visible],
  );
  const byId = useMemo(() => new Map(design.components.map((c) => [c.id, c])), [design.components]);

  // ---- view box
  let vb: [number, number, number, number];
  const maxH = Math.max(1.6, ...design.components.map((c) => blockTop(c.kind)));
  if (fit === 'stable') {
    const R = Math.hypot(w / 2, h / 2) * CELL;
    const top = -R * proj.se - maxH * CELL * proj.ce - 24;
    const bottom = R * proj.se + PLATE_THICKNESS * CELL * proj.ce + 24;
    vb = [-R - 20, top, 2 * R + 40, bottom - top];
  } else if (fit === 'content' && shown.length) {
    // Frame what is built so far (at least a 6×6 cell window), like a manual zooming in on the work.
    let x0 = Math.min(...shown.map((c) => c.x)) - 1;
    let x1 = Math.max(...shown.map((c) => c.x)) + 2;
    let y0 = Math.min(...shown.map((c) => c.y)) - 1;
    let y1 = Math.max(...shown.map((c) => c.y)) + 2;
    const grow = (a: number, b: number, span: number): [number, number] => {
      if (b - a >= span) return [a, b];
      const m = (a + b) / 2;
      return [m - span / 2, m + span / 2];
    };
    [x0, x1] = grow(x0, x1, 6);
    [y0, y1] = grow(y0, y1, 6);
    const pts: [number, number][] = [proj.p(x0, y0, 0), proj.p(x1, y0, 0), proj.p(x1, y1, 0), proj.p(x0, y1, 0)];
    for (const c of shown) pts.push(proj.p(c.x + 0.5, c.y + 0.5, blockTop(c.kind) + 0.6));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    vb = [Math.min(...xs), Math.min(...ys) - 8, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys) + 8];
  } else {
    const pts: [number, number][] = [];
    for (const [x, y] of [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ]) {
      pts.push(proj.p(x, y, 0), proj.p(x, y, -PLATE_THICKNESS));
    }
    for (const c of shown) pts.push(proj.p(c.x + 0.5, c.y + 0.5, blockTop(c.kind) + 0.35));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const pad = 22;
    vb = [Math.min(...xs) - pad, Math.min(...ys) - pad - 10, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2 + 10];
  }
  if (zoom !== 1 || pan.x || pan.y) {
    const cx = vb[0] + vb[2] / 2 + pan.x;
    const cy = vb[1] + vb[3] / 2 + pan.y;
    vb = [cx - vb[2] / (2 * zoom), cy - vb[3] / (2 * zoom), vb[2] / zoom, vb[3] / zoom];
  }

  // ---- baseplate
  const plateColor = '#dcd8ce';
  const plate: ReactElement[] = [];
  {
    const corners: [number, number][] = [
      [0, h],
      [0, 0],
      [w, 0],
      [w, h],
    ];
    const sides: [number, number, number, number][] = [
      [-1, 0, 0, 1],
      [1, 0, 2, 3],
      [0, -1, 1, 2],
      [0, 1, 3, 0],
    ];
    for (const [nx, ny, ia, ib] of sides) {
      if (proj.facing(nx, ny) <= 1e-6) continue;
      const a = corners[ia];
      const b = corners[ib];
      const p = [proj.p(a[0], a[1], -PLATE_THICKNESS), proj.p(b[0], b[1], -PLATE_THICKNESS), proj.p(b[0], b[1], 0), proj.p(a[0], a[1], 0)];
      plate.push(
        <path
          key={`plate${nx}${ny}`}
          d={`M${p.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('L')}Z`}
          fill={shade(plateColor, -0.08 - 0.14 * ((proj.light(nx, ny) + 1) / 2))}
        />,
      );
    }
    const top = [proj.p(0, 0, 0), proj.p(w, 0, 0), proj.p(w, h, 0), proj.p(0, h, 0)];
    plate.push(<path key="plateTop" d={`M${top.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('L')}Z`} fill={plateColor} />);
  }

  // ---- zones
  const zones: ReactElement[] = [];
  const zoneText: ReactElement[] = [];
  for (const d of design.domains) {
    const members = shown.filter((c) => c.domainId === d.id);
    const all = design.components.filter((c) => c.domainId === d.id);
    if (!all.length) continue;
    const src = members.length ? members : all;
    const x0 = Math.min(...src.map((c) => c.x)) + 0.06;
    const x1 = Math.max(...src.map((c) => c.x)) + 0.94;
    const y0 = Math.min(...src.map((c) => c.y)) + 0.06;
    const y1 = Math.max(...src.map((c) => c.y)) + 0.94;
    const corners = [proj.p(x0, y0, 0.01), proj.p(x1, y0, 0.01), proj.p(x1, y1, 0.01), proj.p(x0, y1, 0.01)];
    const dim = focusDomain && focusDomain !== d.id;
    const strong = focusDomain === d.id;
    zones.push(
      <path
        key={`zone-${d.id}`}
        d={`M${corners.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('L')}Z`}
        fill={withAlpha(d.color, dim ? 0.06 : strong ? 0.34 : members.length ? 0.2 : 0.07)}
        stroke={withAlpha(d.color, dim ? 0.2 : 0.75)}
        strokeWidth={strong ? 1.6 : 1}
        strokeDasharray={members.length ? undefined : '3 3'}
      />,
    );
    if (zoneLabels && members.length) {
      const near = corners.reduce((best, q) => (q[1] > best[1] ? q : best), corners[0]);
      zoneText.push(
        <text key={`zl-${d.id}`} x={near[0]} y={near[1] + 13} className="iso-zone-label" fill={shade(d.color, -0.35)} opacity={dim ? 0.35 : 1}>
          {d.name}
        </text>,
      );
    }
  }

  // ---- plate studs on empty cells
  const studs: ReactElement[] = [];
  if (plateStuds && w * h <= 900) {
    const occupied = new Set(shown.map((c) => `${c.x},${c.y}`));
    const [rx, ry] = proj.ellipse(0.11);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (occupied.has(`${x},${y}`)) continue;
        const [sx, sy] = proj.p(x + 0.5, y + 0.5, 0.035);
        studs.push(<ellipse key={`st${x},${y}`} cx={sx.toFixed(1)} cy={sy.toFixed(1)} rx={rx.toFixed(1)} ry={Math.max(0.3, ry).toFixed(1)} className="iso-plate-stud" />);
      }
  }

  // ---- pieces, back to front
  const cylColors = new Set<string>();
  const ordered = [...shown].sort((a, b) => proj.depth(a.x + 0.5, a.y + 0.5) - proj.depth(b.x + 0.5, b.y + 0.5) || a.x - b.x);
  const pieces = ordered.map((c) => {
    const color = blockColor(c.kind, c.lifecycle);
    if (KIND_INFO[c.kind].geometry.shape === 'cylinder') cylColors.add(color);
    const isNew = highlight?.has(c.id);
    const dim = focusDomain && c.domainId !== focusDomain;
    const cls = [
      'iso-block',
      isNew ? 'is-new' : '',
      isNew && animateNew ? 'drop-in' : '',
      c.id === selectedId ? 'is-selected' : '',
      c.id === hoverId ? 'is-hover' : '',
      dim ? 'is-dim' : '',
      onSelect ? 'is-interactive' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <g
        key={c.id}
        className={cls}
        data-id={c.id}
        onPointerEnter={onHover ? () => onHover(c.id) : undefined}
        onPointerLeave={onHover ? () => onHover(null) : undefined}
        onClick={
          onSelect
            ? (e) => {
                e.stopPropagation();
                onSelect(c.id);
              }
            : undefined
        }
      >
        {renderBlock(c.id, c.kind, c.replicas, c, proj, { color })}
      </g>
    );
  });

  // ---- joints
  const linkEls: ReactElement[] = [];
  if (links !== 'none') {
    const focus = selectedId ?? hoverId;
    for (const conn of design.connections) {
      if (links === 'business' && PLATFORM_PROTOCOLS.has(conn.protocol) && conn.id !== selectedConnectionId) continue;
      const a = byId.get(conn.from);
      const b = byId.get(conn.to);
      if (!a || !b) continue;
      if (visible && (!visible.has(a.id) || !visible.has(b.id))) continue;
      const weak = joints?.get(conn.id)?.status === 'weak';
      const hl = highlightLinks?.has(conn.id) || conn.id === selectedConnectionId;
      const related = focus ? conn.from === focus || conn.to === focus : true;
      const faded = (focus && !related) || (highlightLinks && highlightLinks.size > 0 && !hl);
      const color = weak ? '#e5484d' : PROTOCOL_INFO[conn.protocol].color;
      const p0 = proj.p(a.x + 0.5, a.y + 0.5, blockTop(a.kind) + 0.08);
      const p2 = proj.p(b.x + 0.5, b.y + 0.5, blockTop(b.kind) + 0.08);
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const lift = Math.max(blockTop(a.kind), blockTop(b.kind)) + 0.35 + dist * 0.16;
      const p1 = proj.p((a.x + b.x) / 2 + 0.5, (a.y + b.y) / 2 + 0.5, lift);
      const d = `M${p0[0].toFixed(1)} ${p0[1].toFixed(1)}Q${p1[0].toFixed(1)} ${p1[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
      const async = !PROTOCOL_INFO[conn.protocol].sync;
      linkEls.push(
        <g
          key={conn.id}
          className={`iso-link${faded ? ' is-faded' : ''}${hl || (focus && related) ? ' is-hl' : ''}${weak ? ' is-weak' : ''}`}
          onClick={
            onSelectConnection
              ? (e) => {
                  e.stopPropagation();
                  onSelectConnection(conn.id);
                }
              : undefined
          }
        >
          {onSelectConnection && <path d={d} className="iso-link-hit" />}
          <path d={d} stroke={color} className={`iso-link-line${async && !weak ? ' async' : ''}`} />
          <circle cx={p2[0].toFixed(1)} cy={p2[1].toFixed(1)} r={2.2} fill={color} />
        </g>,
      );
    }
  }

  // ---- labels and error badges
  const labelEls: ReactElement[] = [];
  for (const c of shown) {
    const show = labels === 'all' || c.id === selectedId || c.id === hoverId || (highlight?.has(c.id) && labels !== 'none');
    const err = errorIds?.has(c.id);
    if (!show && !err) continue;
    const [x, y] = proj.p(c.x + 0.5, c.y + 0.5, blockTop(c.kind) + 0.12);
    if (err) {
      labelEls.push(
        <g key={`e-${c.id}`} className="iso-err" transform={`translate(${x.toFixed(1)} ${(y - (show ? 22 : 8)).toFixed(1)})`}>
          <circle r={5.5} />
          <text y={2.6}>!</text>
        </g>,
      );
    }
    if (show && labels !== 'none') {
      labelEls.push(
        <text key={`l-${c.id}`} x={x.toFixed(1)} y={(y - 6).toFixed(1)} className={`iso-label${c.id === selectedId ? ' is-selected' : ''}`}>
          {c.name}
        </text>,
      );
    }
  }

  return (
    <svg
      className={`iso-scene ${className ?? ''}`}
      viewBox={vb.map((n) => n.toFixed(1)).join(' ')}
      preserveAspectRatio="xMidYMid meet"
      onClick={onSelect ? () => onSelect(null) : undefined}
      role="img"
      aria-label={title ?? `${design.name} model`}
    >
      <defs>
        {[...cylColors].map((c) => (
          <CylinderGradient key={c} color={c} />
        ))}
      </defs>
      <g className="iso-plate">{plate}</g>
      <g className="iso-zones">{zones}</g>
      <g className="iso-studs">{studs}</g>
      <g className="iso-pieces">{pieces}</g>
      <g className="iso-links">{linkEls}</g>
      <g className="iso-zone-labels">{zoneText}</g>
      <g className="iso-labels">{labelEls}</g>
    </svg>
  );
}

export const IsoScene = memo(IsoSceneImpl);

export function componentAt(design: Design, id: string | null | undefined): ArchComponent | undefined {
  return id ? design.components.find((c) => c.id === id) : undefined;
}
