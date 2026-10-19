import { describe, expect, it } from 'vitest';
import { compile } from '../engine/compile';
import type { DesignDraft } from '../model/types';
import { normalizeDraft } from './normalize';
import { designToDraft } from './prompt';

const draft = (): DesignDraft => ({
  name: 'Tiny shop',
  summary: 'A shop.',
  domains: [{ id: 'orders', name: 'Orders', description: '' }],
  components: [
    { id: 'order-svc', name: 'Order Service', kind: 'service', tech: 'Go', domain: 'orders', replicas: 2, criticality: 'tier-1', lifecycle: 'planned', owner: 'Orders', description: '' },
    { id: 'orders-db', name: 'Orders DB', kind: 'relational-db', tech: 'PostgreSQL', domain: 'orders', replicas: 2, criticality: 'tier-1', lifecycle: 'planned', owner: 'Orders', description: '' },
  ],
  connections: [{ from: 'order-svc', to: 'orders-db', protocol: 'sql', label: 'orders' }],
});

describe('normalizeDraft', () => {
  it('places a clean draft on the baseplate', () => {
    const { design, notes } = normalizeDraft(draft(), { prompt: 'shop' });
    expect(notes).toEqual([]);
    expect(design.components.every((c) => c.x >= 1 && c.y >= 1 && c.x < design.grid.w && c.y < design.grid.h)).toBe(true);
    expect(compile(design).stats.errors).toBe(0);
  });

  it('repairs unknown kinds, protocols, domains and references', () => {
    const d = draft();
    d.components.push({ id: 'mystery', name: 'Mystery Box', kind: 'quantum-thing', tech: '', domain: 'Elsewhere', replicas: 99, criticality: 'tier-9', lifecycle: 'soon', owner: '', description: '' });
    d.connections.push({ from: 'mystery', to: 'orders-db', protocol: 'telepathy', label: '' });
    d.connections.push({ from: 'ghost', to: 'orders-db', protocol: 'sql', label: '' });
    const { design, notes } = normalizeDraft(d, { prompt: 'x' });
    const mystery = design.components.find((c) => c.name === 'Mystery Box')!;
    expect(mystery.kind).toBe('service');
    expect(mystery.replicas).toBe(12);
    expect(mystery.criticality).toBe('tier-2');
    expect(design.domains.some((x) => x.id === mystery.domainId && x.name === 'Elsewhere')).toBe(true);
    expect(design.connections.find((c) => c.from === mystery.id)!.protocol).toBe('sql');
    expect(design.connections).toHaveLength(2);
    expect(notes.length).toBe(3);
  });

  it('keeps cells and joint ids of existing components when changing a build', () => {
    const first = normalizeDraft(draft(), { prompt: 'shop' }).design;
    const next = designToDraft(first);
    next.components.push({ id: 'cache', name: 'Order Cache', kind: 'cache', tech: 'Redis', domain: 'orders', replicas: 2, criticality: 'tier-2', lifecycle: 'planned', owner: '', description: '' });
    next.connections.push({ from: 'order-svc', to: 'cache', protocol: 'kv', label: '' });
    const { design } = normalizeDraft(next, { prompt: 'add cache', previous: first });
    for (const c of first.components) {
      const after = design.components.find((x) => x.id === c.id)!;
      expect([after.x, after.y]).toEqual([c.x, c.y]);
    }
    expect(design.connections.find((c) => c.to === 'orders-db')!.id).toBe(first.connections[0].id);
    const cache = design.components.find((c) => c.id === 'cache')!;
    expect(design.components.filter((c) => c.x === cache.x && c.y === cache.y)).toHaveLength(1);
    expect(design.id).toBe(first.id);
  });
});
