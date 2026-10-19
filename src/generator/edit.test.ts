import { describe, expect, it } from 'vitest';
import { compile } from '../engine/compile';
import { applyChangeRequest } from './edit';
import { generateBlueprint } from './generate';

const base = () => generateBlueprint('E-commerce store').design;

describe('offline change requests', () => {
  it('adds a capability kit that holds together', () => {
    const r = applyChangeRequest(base(), 'add fraud detection');
    expect(r.ok).toBe(true);
    expect(r.design.domains.some((d) => d.name === 'Risk & Fraud')).toBe(true);
    const c = compile(r.design);
    expect(c.issues.filter((i) => i.severity !== 'info')).toEqual([]);
  });

  it('adds a single component and wires it in', () => {
    const r = applyChangeRequest(base(), 'add a redis cache to Orders');
    const cache = r.design.components.find((c) => c.kind === 'cache' && c.domainId === 'orders');
    expect(cache).toBeTruthy();
    expect(cache!.tech).toBe('Redis');
    expect(r.design.connections.some((c) => c.to === cache!.id && c.protocol === 'kv')).toBe(true);
    expect(compile(r.design).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('removes, scales, retechs and connects', () => {
    let d = base();
    d = applyChangeRequest(d, 'scale Order Service to 5').design;
    expect(d.components.find((c) => c.name === 'Order Service')!.replicas).toBe(5);
    d = applyChangeRequest(d, 'use MySQL for Orders DB').design;
    expect(d.components.find((c) => c.name === 'Orders DB')!.tech).toBe('MySQL');
    const before = d.components.length;
    d = applyChangeRequest(d, 'remove Search Indexer').design;
    expect(d.components.length).toBe(before - 1);
    const r = applyChangeRequest(d, 'connect Inventory Service to Orders DB via https');
    expect(r.changes.join(' ')).toMatch(/weak joint/);
    expect(compile(r.design).stats.weakJoints).toBe(1);
  });

  it('reports what it could not understand', () => {
    const r = applyChangeRequest(base(), 'make it sparkle');
    expect(r.ok).toBe(false);
    expect(r.unrecognized).toEqual(['make it sparkle']);
  });
});
