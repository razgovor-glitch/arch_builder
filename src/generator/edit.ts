import {
  KIND_INFO,
  PROTOCOL_INFO,
  TELEMETRY_KINDS,
  categoryOf,
  preferredProtocol,
} from '../model/catalog';
import { COMPONENT_KINDS, PROTOCOLS, type ArchComponent, type ComponentKind, type Design, type Lifecycle, type Protocol } from '../model/types';
import { slugify, titleCase } from '../model/util';
import {
  addComponent,
  addDomain,
  connect,
  removeComponents,
  removeConnections,
  removeDomain,
  updateComponent,
} from '../engine/ops';
import { CAPABILITY_TRIGGERS, KITS, type Kit } from './blueprints';

export interface EditResult {
  design: Design;
  ok: boolean;
  changes: string[];
  unrecognized: string[];
}

export const EDIT_HELP = [
  'add a Redis cache to Orders',
  'add fraud detection / search / analytics / notifications',
  'connect Order Service to Payments Ledger via sql',
  'remove Search Indexer',
  'scale Payment Service to 4',
  'use MySQL for Orders DB',
  'move Cart Service to Orders',
  'rename Core API to Platform API',
  'make Catalog Service tier-1',
  'mark Hospital EHR as retiring',
  'make everything highly available',
];

// ---------------------------------------------------------------- lookups

function score(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.toLowerCase().replace(/^(the|a|an)\s+/, '').trim();
  if (!q) return 0;
  if (n === q) return 100;
  if (n.includes(q) || q.includes(n)) return 80 - Math.abs(n.length - q.length) / 4;
  const nt = new Set(n.split(/[^a-z0-9]+/).filter(Boolean));
  const qt = q.split(/[^a-z0-9]+/).filter(Boolean);
  if (!qt.length) return 0;
  const hits = qt.filter((t) => nt.has(t) || [...nt].some((w) => w.startsWith(t) && t.length > 2)).length;
  return (hits / Math.max(qt.length, nt.size)) * 70;
}

export function findComponent(design: Design, query: string): ArchComponent | null {
  let best: ArchComponent | null = null;
  let bestScore = 39;
  for (const c of design.components) {
    const s = Math.max(score(c.name, query), score(c.id.replace(/-/g, ' '), query));
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

function findDomain(design: Design, query: string) {
  let best: Design['domains'][number] | null = null;
  let bestScore = 39;
  for (const d of design.domains) {
    const s = score(d.name, query.replace(/\b(domain|sub-?build|team|area|district)\b/g, '').trim());
    if (s > bestScore) {
      best = d;
      bestScore = s;
    }
  }
  return best;
}

function findKind(text: string): ComponentKind | null {
  let best: ComponentKind | null = null;
  let bestLen = 0;
  for (const kind of COMPONENT_KINDS) {
    for (const syn of [...KIND_INFO[kind].synonyms, KIND_INFO[kind].label.toLowerCase()]) {
      if (new RegExp(`\\b${syn.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\b`).test(text) && syn.length > bestLen) {
        best = kind;
        bestLen = syn.length;
      }
    }
  }
  return best;
}

function findTech(kind: ComponentKind, text: string): string | null {
  const t = text.toLowerCase();
  for (const option of KIND_INFO[kind].techOptions) {
    const first = option.toLowerCase().split(/[\s(/]+/)[0];
    if (t.includes(option.toLowerCase()) || (first.length > 2 && new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t))) {
      return option;
    }
  }
  return null;
}

function parseProtocol(text: string | undefined): Protocol | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  return (PROTOCOLS as readonly string[]).includes(t)
    ? (t as Protocol)
    : (Object.entries(PROTOCOL_INFO).find(([, info]) => info.label.toLowerCase() === t)?.[0] as Protocol | undefined);
}

// ---------------------------------------------------------- shared aliases

const ALIAS_KINDS: Record<string, ComponentKind> = {
  '@gateway': 'api-gateway',
  '@identity': 'identity',
  '@observability': 'observability',
  '@secrets': 'secrets',
  '@bus': 'event-stream',
  '@cdn': 'cdn',
  '@iothub': 'iot-hub',
};

function resolveAlias(design: Design, alias: string): ArchComponent | null {
  const kind = ALIAS_KINDS[alias];
  if (kind) return design.components.find((c) => c.kind === kind) ?? null;
  const word = alias.slice(1);
  return design.components.find((c) => c.name.toLowerCase().includes(word) && categoryOf(c.kind) === 'application') ?? null;
}

/** Adds a blueprint kit as a new sub-build wired into what already exists. */
export function addKit(design: Design, kit: Kit, changes: string[]): Design {
  if (design.domains.some((d) => d.name.toLowerCase() === kit.domain.toLowerCase())) {
    changes.push(`${kit.domain} is already part of the build.`);
    return design;
  }
  let next = design;
  const needsBus = kit.links.some((l) => (l.from === '@bus' || l.to === '@bus') && !l.optional);
  if (needsBus && !resolveAlias(next, '@bus')) next = addKit(next, KITS.integration, changes);

  const added = addDomain(next, kit.domain, kit.description);
  next = added.design;
  const local = new Map<string, string>();
  for (const p of kit.parts) {
    const info = KIND_INFO[p.kind];
    const tier = p.tier ?? 2;
    const replicas = info.category === 'experience' || info.category === 'external' ? 1 : Math.max(p.replicas ?? 2, tier === 1 ? 2 : 1);
    const res = addComponent(next, {
      kind: p.kind,
      name: next.components.some((c) => c.name === p.name) ? `${p.name} (${kit.domain})` : p.name,
      tech: p.tech,
      domainId: added.domain.id,
      replicas,
      criticality: `tier-${tier}`,
      lifecycle: p.lifecycle ?? 'planned',
      description: p.description,
    });
    next = res.design;
    local.set(p.key, res.component.id);
  }
  const resolve = (ref: string) => (ref.startsWith('@') ? resolveAlias(next, ref)?.id : local.get(ref));
  for (const l of kit.links) {
    const from = resolve(l.from);
    const to = resolve(l.to);
    if (from && to) next = connect(next, from, to, l.protocol, l.label).design;
  }
  const gateway = resolveAlias(next, '@gateway');
  if (gateway) {
    for (const key of kit.expose ?? []) {
      const id = local.get(key);
      if (id) next = connect(next, gateway.id, id, 'https', `routes /${slugify(kit.domain)}`).design;
    }
  }
  const observability = resolveAlias(next, '@observability');
  if (observability) {
    for (const id of local.values()) {
      const c = next.components.find((x) => x.id === id)!;
      if (TELEMETRY_KINDS.has(c.kind)) next = connect(next, id, observability.id, 'otlp', 'traces, metrics, logs').design;
    }
  }
  changes.push(`Added the ${kit.domain} sub-build (${kit.parts.length} components).`);
  return next;
}

// ------------------------------------------------------------------ commands

function addSingle(design: Design, clause: string, raw: string, changes: string[]): Design | null {
  const kind = findKind(clause);
  if (!kind) return null;
  const info = KIND_INFO[kind];
  const named = raw.match(/\b(?:called|named)\s+["“]?([^"”,]+?)["”]?(?:\s+(?:to|in|for|into|connected|that|which)\b|$)/i);
  const target = clause.match(/\b(?:to|in|into|for|inside|within)\s+(?:the\s+)?(.+?)(?:\s+(?:connected|wired|linked)\b.*)?$/);
  const connectedTo = clause.match(/\b(?:connected|wired|linked)\s+(?:to|with)\s+(?:the\s+)?(.+)$/);

  let domain = target ? findDomain(design, target[1]) : null;
  let anchor = connectedTo ? findComponent(design, connectedTo[1]) : null;
  if (!anchor && target && !domain) anchor = findComponent(design, target[1]);
  if (!domain && anchor) domain = design.domains.find((d) => d.id === anchor!.domainId) ?? null;

  let next = design;
  if (!domain) {
    if (target && !anchor) {
      const created = addDomain(next, titleCase(target[1].replace(/\b(domain|sub-?build)\b/g, '').trim()) || 'General');
      next = created.design;
      domain = created.domain;
    } else {
      domain = next.domains.find((d) => !['platform-security', 'edge-access', 'integration-backbone', 'channels'].includes(d.id)) ?? next.domains[0] ?? null;
      if (!domain) {
        const created = addDomain(next, 'General');
        next = created.design;
        domain = created.domain;
      }
    }
  }

  const name = named?.[1]?.trim() ? titleCase(named[1].trim()) : `${domain.name} ${info.label}`;
  const res = addComponent(next, {
    kind,
    name: next.components.some((c) => c.name === name) ? `${name} 2` : name,
    tech: findTech(kind, raw) ?? undefined,
    domainId: domain.id,
  });
  next = res.design;
  const comp = res.component;
  changes.push(`Added ${comp.name} (${info.label}, ${comp.tech}) to ${domain.name}.`);

  // Wire it in so it is not a floating piece.
  const wire = (from: ArchComponent, to: ArchComponent) => {
    const p = preferredProtocol(from.kind, to.kind);
    if (!p) return false;
    next = connect(next, from.id, to.id, p).design;
    changes.push(`Connected ${from.name} → ${to.name} over ${PROTOCOL_INFO[p].label}.`);
    return true;
  };
  const candidates = anchor ? [anchor] : next.components.filter((c) => c.domainId === domain!.id && c.id !== comp.id);
  let wired = false;
  for (const other of candidates) {
    if (wire(other, comp) || wire(comp, other)) {
      wired = true;
      break;
    }
  }
  if (!wired && KIND_INFO[kind].consumes.includes('kafka')) {
    const bus = resolveAlias(next, '@bus');
    if (bus) wired = wire(comp, bus);
  }
  if (!wired) {
    const gateway = resolveAlias(next, '@gateway');
    if (gateway) wired = wire(gateway, comp);
  }
  if (['service', 'bff', 'workflow'].includes(kind)) {
    const gateway = resolveAlias(next, '@gateway');
    if (gateway && !next.connections.some((c) => c.from === gateway.id && c.to === comp.id)) wire(gateway, comp);
  }
  if (TELEMETRY_KINDS.has(kind)) {
    const observability = resolveAlias(next, '@observability');
    if (observability) next = connect(next, comp.id, observability.id, 'otlp', 'traces, metrics, logs').design;
  }
  if (!wired) changes.push(`⚠ ${comp.name} has no joints yet — connect it to something.`);
  return next;
}

function applyClause(design: Design, raw: string, changes: string[]): Design | null {
  const clause = raw.toLowerCase().trim().replace(/[.!]+$/, '');
  let m: RegExpMatchArray | null;

  if (/^(make|set) (everything|all|the whole (thing|build|platform)) (highly available|ha|redundant|resilient)/.test(clause)) {
    let next = design;
    let n = 0;
    for (const c of design.components) {
      const cat = categoryOf(c.kind);
      if (cat === 'experience' || cat === 'external' || c.replicas >= 2) continue;
      next = updateComponent(next, c.id, { replicas: 2 });
      n++;
    }
    changes.push(n ? `Scaled ${n} single-instance components to 2 replicas.` : 'Everything already runs at least 2 replicas.');
    return next;
  }

  if ((m = clause.match(/^rename (.+?) (?:to|as) (.+)$/))) {
    const c = findComponent(design, m[1]);
    const newName = raw.trim().replace(/[.!]+$/, '').slice(raw.toLowerCase().lastIndexOf(m[2])).trim();
    if (c) {
      changes.push(`Renamed ${c.name} to ${newName}.`);
      return updateComponent(design, c.id, { name: newName });
    }
    const d = findDomain(design, m[1]);
    if (d) {
      changes.push(`Renamed sub-build ${d.name} to ${newName}.`);
      return { ...design, domains: design.domains.map((x) => (x.id === d.id ? { ...x, name: newName } : x)) };
    }
    return null;
  }

  if ((m = clause.match(/^(?:remove|delete|drop|get rid of) (?:the )?(.+?)(?: (?:sub-?build|domain))?$/))) {
    const c = findComponent(design, m[1]);
    const d = findDomain(design, m[1]);
    if (d && (!c || score(d.name, m[1]) >= score(c.name, m[1]))) {
      const count = design.components.filter((x) => x.domainId === d.id).length;
      changes.push(`Removed the ${d.name} sub-build and its ${count} components.`);
      return removeDomain(design, d.id);
    }
    if (c) {
      const joints = design.connections.filter((x) => x.from === c.id || x.to === c.id).length;
      changes.push(`Removed ${c.name} and its ${joints} joints.`);
      return removeComponents(design, [c.id]);
    }
    return null;
  }

  if ((m = clause.match(/^(?:disconnect|unlink|unwire) (.+?) (?:from|and) (.+)$/))) {
    const a = findComponent(design, m[1]);
    const b = findComponent(design, m[2]);
    if (!a || !b) return null;
    const ids = design.connections.filter((c) => (c.from === a.id && c.to === b.id) || (c.from === b.id && c.to === a.id)).map((c) => c.id);
    changes.push(ids.length ? `Disconnected ${a.name} and ${b.name}.` : `${a.name} and ${b.name} were not connected.`);
    return removeConnections(design, ids);
  }

  if ((m = clause.match(/^(?:connect|link|wire) (.+?) (?:to|with|->|→) (.+?)(?: (?:via|over|using) ([\w/-]+))?$/))) {
    const a = findComponent(design, m[1]);
    const b = findComponent(design, m[2]);
    if (!a || !b) return null;
    const protocol = parseProtocol(m[3]);
    const res = connect(design, a.id, b.id, protocol);
    if (!res.connection) return null;
    const p = PROTOCOL_INFO[res.connection.protocol].label;
    const grips = KIND_INFO[b.kind].provides.includes(res.connection.protocol) && KIND_INFO[a.kind].consumes.includes(res.connection.protocol);
    changes.push(`Connected ${a.name} → ${b.name} over ${p}${grips ? '' : ' (⚠ weak joint: interfaces do not match)'}.`);
    return res.design;
  }

  if ((m = clause.match(/^(?:scale|resize) (.+?) (?:to|at) (\d+)(?: replicas?| instances?| nodes?)?$/)) || (m = clause.match(/^(?:set|give) (.+?) (\d+) (?:replicas?|instances?|nodes?)$/))) {
    const c = findComponent(design, m[1]);
    if (!c) return null;
    const n = Math.max(1, Math.min(12, Number(m[2])));
    changes.push(`Scaled ${c.name} to ${n} replica${n === 1 ? '' : 's'}.`);
    return updateComponent(design, c.id, { replicas: n });
  }

  if ((m = clause.match(/^make (.+?) (?:highly available|ha|redundant|resilient)$/))) {
    const c = findComponent(design, m[1]);
    if (!c) return null;
    changes.push(`Made ${c.name} highly available (3 replicas, tier-1).`);
    return updateComponent(design, c.id, { replicas: Math.max(3, c.replicas), criticality: 'tier-1' });
  }

  if ((m = clause.match(/^make (.+?) tier[- ]?([123])$/))) {
    const c = findComponent(design, m[1]);
    if (!c) return null;
    changes.push(`Set ${c.name} to tier-${m[2]}.`);
    return updateComponent(design, c.id, { criticality: `tier-${m[2]}` as ArchComponent['criticality'] });
  }

  if ((m = clause.match(/^(?:mark|set|flag) (.+?) (?:as )?(live|planned|retiring|retired|deprecated|in build|build)$/))) {
    const c = findComponent(design, m[1]);
    if (!c) return null;
    const lifecycle: Lifecycle = m[2] === 'retired' || m[2] === 'deprecated' ? 'retiring' : m[2] === 'in build' ? 'build' : (m[2] as Lifecycle);
    changes.push(`Marked ${c.name} as ${lifecycle}.`);
    return updateComponent(design, c.id, { lifecycle });
  }

  if ((m = clause.match(/^use (.+?) (?:for|as|in) (?:the )?(.+)$/))) {
    const c = findComponent(design, m[2]);
    if (!c) return null;
    const tech = findTech(c.kind, m[1]) ?? titleCase(raw.slice(4, 4 + m[1].length).trim());
    changes.push(`${c.name} now uses ${tech}.`);
    return updateComponent(design, c.id, { tech });
  }

  if ((m = clause.match(/^(?:switch|change|migrate|move) (.+?) (?:to|into|onto) (.+)$/))) {
    const c = findComponent(design, m[1]);
    if (!c) return null;
    const d = findDomain(design, m[2]);
    if (d && /^move/.test(clause)) {
      changes.push(`Moved ${c.name} to ${d.name}.`);
      return updateComponent(design, c.id, { domainId: d.id });
    }
    const tech = findTech(c.kind, m[2]);
    if (tech) {
      changes.push(`${c.name} now uses ${tech}.`);
      return updateComponent(design, c.id, { tech });
    }
    const kind = findKind(m[2]);
    if (kind && kind !== c.kind) {
      changes.push(`Changed ${c.name} from ${KIND_INFO[c.kind].label} to ${KIND_INFO[kind].label} — check its joints.`);
      return updateComponent(design, c.id, { kind, tech: findTech(kind, m[2]) ?? KIND_INFO[kind].defaultTech });
    }
    if (d) {
      changes.push(`Moved ${c.name} to ${d.name}.`);
      return updateComponent(design, c.id, { domainId: d.id });
    }
    return null;
  }

  if ((m = clause.match(/^(?:add|include|introduce|create|we need|i need|plus|also add|now add) (?:an? |the |some )?(.+)$/))) {
    const what = m[1];
    if (/mobile( app)?|ios|android/.test(what) && !/database|cache|service/.test(what)) {
      const channels = design.domains.find((d) => d.id === 'channels') ?? null;
      let next = design;
      let domainId = channels?.id;
      if (!domainId) {
        const created = addDomain(next, 'Channels');
        next = created.design;
        domainId = created.domain.id;
      }
      const res = addComponent(next, { kind: 'mobile-app', name: 'Mobile App', domainId, replicas: 1 });
      next = res.design;
      const gateway = resolveAlias(next, '@gateway');
      const identity = resolveAlias(next, '@identity');
      if (gateway) next = connect(next, res.component.id, gateway.id, 'https', 'API calls').design;
      if (identity) next = connect(next, res.component.id, identity.id, 'oidc', 'sign-in').design;
      changes.push(`Added a Mobile App to Channels${gateway ? ', wired to the API Gateway' : ''}.`);
      return next;
    }
    const capability = CAPABILITY_TRIGGERS.find((t) => t.pattern.test(what));
    const kindHit = findKind(what);
    if (capability && (!kindHit || /detection|capabilit|sub-?build|feature|module|domain|personali|recommend|notification|analytics|audit|webhook|workflow|approval/.test(what))) {
      return addKit(design, KITS[capability.kit], changes);
    }
    return addSingle(design, what, raw.replace(/^\s*\S+\s+(?:an?\s+|the\s+|some\s+)?/i, ''), changes);
  }

  return null;
}

/** Offline change requests: a small command language over the current build. */
export function applyChangeRequest(design: Design, text: string): EditResult {
  const clauses = text
    .split(/(?:[.;\n]+|,?\s+then\s+|,\s*and\s+(?=(?:add|remove|delete|connect|scale|rename|use|move|make|mark|switch|change)\b))/i)
    .map((s) => s.trim())
    .filter(Boolean);
  let next = design;
  const changes: string[] = [];
  const unrecognized: string[] = [];
  for (const clause of clauses) {
    const result = applyClause(next, clause, changes);
    if (result) next = result;
    else unrecognized.push(clause);
  }
  return { design: next, ok: unrecognized.length < clauses.length, changes, unrecognized };
}
