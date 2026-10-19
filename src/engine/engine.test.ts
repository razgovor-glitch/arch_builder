import { describe, expect, it } from 'vitest';
import { compile } from './compile';
import { addComponent, addDomain, connect, emptyDesign, applyFix } from './ops';
import { generateBlueprint } from '../generator/generate';
import { TEMPLATES } from '../generator/blueprints';
import type { Design } from '../model/types';

function tiny(): Design {
  let d = emptyDesign('Tiny');
  d = addDomain(d, 'Orders').design;
  const dom = d.domains[0].id;
  const svc = addComponent(d, { kind: 'service', name: 'Order Service', domainId: dom, criticality: 'tier-2' });
  d = svc.design;
  const db = addComponent(d, { kind: 'relational-db', name: 'Orders DB', domainId: dom });
  d = db.design;
  d = connect(d, svc.component.id, db.component.id).design;
  return d;
}

describe('joints', () => {
  it('a matching stud and socket grips', () => {
    const r = compile(tiny());
    expect(r.stats.joints).toBe(1);
    expect(r.stats.weakJoints).toBe(0);
    expect(r.stats.errors).toBe(0);
  });

  it('a protocol the provider does not expose is a weak joint, with a fix', () => {
    const d = tiny();
    d.connections[0] = { ...d.connections[0], protocol: 'https' };
    const r = compile(d);
    expect(r.stats.weakJoints).toBe(1);
    const issue = r.issues.find((i) => i.rule === 'weak-joint')!;
    expect(issue.severity).toBe('error');
    expect(issue.fix?.actions[0]).toMatchObject({ type: 'set-protocol', protocol: 'sql' });
    expect(compile(applyFix(d, issue.fix!.actions)).stats.weakJoints).toBe(0);
  });

  it('side-by-side contact holds nothing: unconnected pieces float', () => {
    let d = tiny();
    d = addComponent(d, { kind: 'cache', name: 'Loose Cache', domainId: d.domains[0].id }).design;
    const r = compile(d);
    expect(r.issues.some((i) => i.rule === 'floating-piece')).toBe(true);
  });

  it('flags separate islands', () => {
    let d = tiny();
    const a = addComponent(d, { kind: 'service', name: 'Island A', domainId: d.domains[0].id });
    d = a.design;
    const b = addComponent(d, { kind: 'cache', name: 'Island B', domainId: d.domains[0].id });
    d = connect(b.design, a.component.id, b.component.id).design;
    expect(compile(d).issues.filter((i) => i.rule === 'loose-island')).toHaveLength(1);
  });

  it('flags collisions and re-places them', () => {
    const d = tiny();
    d.components[1] = { ...d.components[1], x: d.components[0].x, y: d.components[0].y };
    const r = compile(d);
    const issue = r.issues.find((i) => i.rule === 'collision')!;
    expect(issue).toBeTruthy();
    expect(compile(applyFix(d, issue.fix!.actions)).issues.some((i) => i.rule === 'collision')).toBe(false);
  });
});

describe('build plan and manual', () => {
  it('builds providers before consumers and installs every piece once', () => {
    const { design } = generateBlueprint('E-commerce marketplace with search, recommendations and a mobile app');
    const r = compile(design);
    const installs = r.steps.flatMap((s) => s.adds);
    expect(new Set(installs).size).toBe(design.components.length);
    expect(installs).toHaveLength(design.components.length);
    const wired = r.steps.flatMap((s) => s.wires);
    expect(new Set(wired).size).toBe(design.connections.length);
    // Within a sub-build, a dependency is installed before its consumer.
    for (const conn of design.connections) {
      const from = r.index.byId.get(conn.from)!;
      const to = r.index.byId.get(conn.to)!;
      if (from.domainId === to.domainId) {
        expect(r.installedAt.get(conn.to)!).toBeLessThan(r.installedAt.get(conn.from)!);
      }
    }
    expect(r.pages[0].kind).toBe('cover');
    expect(r.pages.at(-1)!.kind).toBe('final');
    expect(r.pages.filter((p) => p.kind === 'step')).toHaveLength(r.steps.length);
  });
});

describe('blueprints hold together', () => {
  const prompts = [
    ...TEMPLATES.map((t) => `${t.keywords.slice(0, 3).join(' ')} platform`),
    'Something for our internal teams',
    'E-commerce marketplace with search, recommendations, analytics, fraud detection, audit, partner webhooks, real-time chat, approvals, legacy SAP ERP and a mobile app on AWS in Java',
    'Core banking with payments, fraud detection and a mainframe on Azure, global scale',
    'Hospital patient records with HL7/FHIR integration, mobile app and analytics',
    'IoT telemetry for 1M sensors in factories with a legacy MES, on GCP',
    'Multi-tenant B2B SaaS with SSO, billing, search, realtime collaboration and webhooks',
    'Video streaming MVP',
    'Insurance claims and policy admin with a legacy AS/400',
    'Logistics tracking with real-time ETAs and a driver app',
  ];
  it.each(prompts)('%s', (prompt) => {
    const { design } = generateBlueprint(prompt);
    const r = compile(design);
    const problems = r.issues.filter((i) => i.severity !== 'info').map((i) => `${i.rule}: ${i.message}`);
    expect(problems).toEqual([]);
    expect(r.stats.components).toBeGreaterThan(8);
  });
});
