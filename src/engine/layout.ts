import { CATEGORY_INFO, categoryOf } from '../model/catalog';
import type { ArchComponent, Category, Design } from '../model/types';
import { orderDomains } from './plan';

/** Back-to-front placement inside a district: stores at the back, entry points at the front. */
const LAYER: Record<Category, number> = {
  platform: 0,
  external: 0.6,
  data: 1,
  integration: 1.2,
  application: 2,
  edge: 3,
  experience: 4,
};

function blockColumns(n: number): number {
  if (n <= 3) return Math.max(1, n);
  if (n <= 6) return 3;
  return 4;
}

/** Packs every domain into its own rectangular district, providers at the back and channels at the front. */
export function autoLayout(design: Design): Design {
  const order = new Map(orderDomains(design).map((id, i) => [id, i]));
  const groups = new Map<string, ArchComponent[]>();
  for (const c of design.components) {
    if (!groups.has(c.domainId)) groups.set(c.domainId, []);
    groups.get(c.domainId)!.push(c);
  }
  const blocks = [...groups.entries()]
    .map(([domainId, members]) => {
      const sorted = [...members].sort(
        (a, b) =>
          LAYER[categoryOf(a.kind)] - LAYER[categoryOf(b.kind)] ||
          CATEGORY_INFO[categoryOf(a.kind)].order - CATEGORY_INFO[categoryOf(b.kind)].order ||
          a.name.localeCompare(b.name),
      );
      const cols = blockColumns(sorted.length);
      return { domainId, members: sorted, cols, rows: Math.ceil(sorted.length / cols) };
    })
    .sort((a, b) => (order.get(a.domainId) ?? 99) - (order.get(b.domainId) ?? 99));

  const area = blocks.reduce((s, b) => s + (b.cols + 1) * (b.rows + 1), 0);
  const shelfWidth = Math.max(8, Math.ceil(Math.sqrt(area) * 1.35));

  const positions = new Map<string, { x: number; y: number }>();
  let x = 0;
  let y = 0;
  let shelfHeight = 0;
  let maxX = 0;
  let maxY = 0;
  for (const block of blocks) {
    if (x > 0 && x + block.cols > shelfWidth) {
      x = 0;
      y += shelfHeight + 1;
      shelfHeight = 0;
    }
    block.members.forEach((c, i) => {
      const px = 1 + x + (i % block.cols);
      const py = 1 + y + Math.floor(i / block.cols);
      positions.set(c.id, { x: px, y: py });
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    });
    x += block.cols + 1;
    shelfHeight = Math.max(shelfHeight, block.rows);
  }

  return {
    ...design,
    grid: { w: Math.max(4, maxX + 2), h: Math.max(4, maxY + 2) },
    components: design.components.map((c) => ({ ...c, ...positions.get(c.id)! })),
  };
}

/**
 * Places the given components into free cells next to the rest of their domain,
 * leaving every other piece where it is. Grows the baseplate when needed.
 */
export function placeComponents(design: Design, ids: string[]): Design {
  const pending = new Set(ids);
  const occupied = new Map<string, string>();
  const placed = new Map<string, ArchComponent>();
  for (const c of design.components) {
    if (!pending.has(c.id)) {
      occupied.set(`${c.x},${c.y}`, c.domainId);
      placed.set(c.id, c);
    }
  }

  const free = (x: number, y: number) => x >= 1 && y >= 1 && !occupied.has(`${x},${y}`);
  const touchesForeign = (x: number, y: number, domainId: string) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const owner = occupied.get(`${x + dx},${y + dy}`);
        if (owner && owner !== domainId) return true;
      }
    return false;
  };

  const updates = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    const comp = design.components.find((c) => c.id === id);
    if (!comp) continue;
    const siblings = [...placed.values()].filter((c) => c.domainId === comp.domainId);
    let target: { x: number; y: number } | null = null;

    if (siblings.length) {
      const x0 = Math.min(...siblings.map((s) => s.x));
      const x1 = Math.max(...siblings.map((s) => s.x));
      const y0 = Math.min(...siblings.map((s) => s.y));
      const y1 = Math.max(...siblings.map((s) => s.y));
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      let fallback: { x: number; y: number; score: number } | null = null;
      for (let r = 0; r < 40 && !target; r++) {
        let best: { x: number; y: number; score: number } | null = null;
        for (let y = y0 - r; y <= y1 + r; y++) {
          for (let x = x0 - r; x <= x1 + r; x++) {
            const onRing = r === 0 || x === x0 - r || x === x1 + r || y === y0 - r || y === y1 + r;
            if (!onRing || !free(x, y)) continue;
            const score = Math.hypot(x - cx, y - cy);
            if (touchesForeign(x, y, comp.domainId)) {
              if (!fallback || score < fallback.score) fallback = { x, y, score };
              continue;
            }
            if (!best || score < best.score) best = { x, y, score };
          }
        }
        if (best) target = best;
      }
      target ??= fallback;
    }

    if (!target) {
      // A new district below everything that exists.
      const maxY = Math.max(0, ...[...placed.values()].map((c) => c.y));
      let x = 1;
      const y = placed.size ? maxY + 2 : 1;
      while (!free(x, y)) x++;
      target = { x, y };
    }

    occupied.set(`${target.x},${target.y}`, comp.domainId);
    placed.set(comp.id, { ...comp, ...target });
    updates.set(comp.id, target);
  }

  const components = design.components.map((c) => (updates.has(c.id) ? { ...c, ...updates.get(c.id)! } : c));
  const maxX = Math.max(0, ...components.map((c) => c.x));
  const maxY = Math.max(0, ...components.map((c) => c.y));
  return {
    ...design,
    components,
    grid: { w: Math.max(design.grid.w, maxX + 2), h: Math.max(design.grid.h, maxY + 2) },
  };
}

/** Grows (or shrinks) the baseplate to fit the pieces with a one-cell margin. */
export function fitGrid(design: Design): Design {
  if (!design.components.length) return { ...design, grid: { w: 8, h: 6 } };
  // Only shift when something fell off the near edge, so editing never makes the plate jump.
  const minX = Math.min(...design.components.map((c) => c.x));
  const minY = Math.min(...design.components.map((c) => c.y));
  const dx = minX < 1 ? 1 - minX : 0;
  const dy = minY < 1 ? 1 - minY : 0;
  const components = design.components.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
  const maxX = Math.max(...components.map((c) => c.x));
  const maxY = Math.max(...components.map((c) => c.y));
  return { ...design, components, grid: { w: maxX + 2, h: maxY + 2 } };
}
