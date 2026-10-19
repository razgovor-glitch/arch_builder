import { memo } from 'react';
import { KIND_INFO } from '../model/catalog';
import type { ComponentKind } from '../model/types';
import { makeProjector, VIEWS } from './camera';
import { CylinderGradient, blockColor, blockTop, renderBlock } from './blocks';

/** A single piece rendered on its own, for parts lists and palettes. */
function BrickIconImpl({ kind, replicas = 1, size = 40 }: { kind: ComponentKind; replicas?: number; size?: number }) {
  const proj = makeProjector(VIEWS.iso, { x: 0.5, y: 0.5 });
  const top = blockTop(kind) + 0.1;
  const g = KIND_INFO[kind].geometry;
  const half = Math.max(g.w, g.d, g.cap?.w ?? 0) * 0.75 + 0.1;
  const pts = [proj.p(0.5 - half, 0.5 - half, 0), proj.p(0.5 + half, 0.5 + half, 0), proj.p(0.5 + half, 0.5 - half, 0), proj.p(0.5 - half, 0.5 + half, 0), proj.p(0.5, 0.5, top)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const pad = 2;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const width = Math.max(...xs) - minX + pad;
  const height = Math.max(...ys) - minY + pad;
  const color = blockColor(kind);
  const side = Math.max(width, height);
  return (
    <svg
      className="brick-icon"
      width={size}
      height={size}
      viewBox={`${(minX - (side - width) / 2).toFixed(1)} ${(minY - (side - height) / 2).toFixed(1)} ${side.toFixed(1)} ${side.toFixed(1)}`}
      aria-hidden
    >
      <defs>{g.shape === 'cylinder' && <CylinderGradient color={color} />}</defs>
      {renderBlock('icon', kind, replicas, { x: 0, y: 0 }, proj, { color })}
    </svg>
  );
}

export const BrickIcon = memo(BrickIconImpl);
