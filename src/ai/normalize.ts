import { DOMAIN_COLORS, KIND_INFO, preferredProtocol } from '../model/catalog';
import {
  COMPONENT_KINDS,
  CRITICALITIES,
  LIFECYCLES,
  PROTOCOLS,
  type ArchComponent,
  type ComponentKind,
  type Connection,
  type Criticality,
  type Design,
  type DesignDraft,
  type Domain,
  type Lifecycle,
  type Protocol,
} from '../model/types';
import { clamp, nowIso, slugify, uid, uniqueId } from '../model/util';
import { autoLayout, fitGrid, placeComponents } from '../engine/layout';

const isKind = (k: string): k is ComponentKind => (COMPONENT_KINDS as readonly string[]).includes(k);
const isProtocol = (p: string): p is Protocol => (PROTOCOLS as readonly string[]).includes(p);
const isCriticality = (c: string): c is Criticality => (CRITICALITIES as readonly string[]).includes(c);
const isLifecycle = (l: string): l is Lifecycle => (LIFECYCLES as readonly string[]).includes(l);

/**
 * Turns a draft (from Claude or the blueprint engine) into a placed, well-formed design.
 * Unknown kinds, protocols and references are repaired or dropped, with notes.
 * When `previous` is given, components that already existed keep their cells.
 */
export function normalizeDraft(
  draft: DesignDraft,
  opts: { prompt: string; previous?: Design | null },
): { design: Design; notes: string[] } {
  const notes: string[] = [];
  const previous = opts.previous ?? null;
  const now = nowIso();

  // Domains
  const domainIds = new Set<string>();
  const domainByKey = new Map<string, Domain>();
  const domains: Domain[] = [];
  const usedColors = new Set<string>();
  const colorFor = (id: string) => {
    const prior = previous?.domains.find((d) => d.id === id)?.color;
    const color =
      prior && !usedColors.has(prior)
        ? prior
        : (DOMAIN_COLORS.find((c) => !usedColors.has(c)) ?? DOMAIN_COLORS[domains.length % DOMAIN_COLORS.length]);
    usedColors.add(color);
    return color;
  };
  const addDomain = (rawId: string, name: string, description: string) => {
    const id = uniqueId(slugify(rawId || name), domainIds);
    const domain: Domain = { id, name: name || rawId, color: colorFor(id), description };
    domains.push(domain);
    domainByKey.set(rawId.toLowerCase(), domain);
    domainByKey.set(name.toLowerCase(), domain);
    domainByKey.set(id, domain);
    return domain;
  };
  for (const d of draft.domains ?? []) addDomain(String(d.id ?? ''), String(d.name ?? d.id ?? 'Domain'), String(d.description ?? ''));

  // Components
  const componentIds = new Set<string>();
  const idMap = new Map<string, string>();
  const components: ArchComponent[] = [];
  for (const raw of draft.components ?? []) {
    let kind: ComponentKind = 'service';
    if (isKind(raw.kind)) kind = raw.kind;
    else notes.push(`Unknown kind “${raw.kind}” for ${raw.name}; treated as a service.`);
    const domainKey = String(raw.domain ?? '').toLowerCase();
    const domain = domainByKey.get(domainKey) ?? domainByKey.get(slugify(domainKey)) ?? addDomain(raw.domain || 'general', raw.domain ? String(raw.domain) : 'General', '');
    const name = String(raw.name || raw.id || KIND_INFO[kind].label);
    const id = uniqueId(slugify(String(raw.id || name)), componentIds);
    idMap.set(String(raw.id || name), id);
    idMap.set(name.toLowerCase(), id);
    const prior = previous?.components.find((c) => c.id === id);
    components.push({
      id,
      name,
      kind,
      tech: String(raw.tech || KIND_INFO[kind].defaultTech),
      domainId: domain.id,
      x: prior?.x ?? -1,
      y: prior?.y ?? -1,
      replicas: clamp(Math.round(Number(raw.replicas) || 1), 1, 12),
      criticality: isCriticality(raw.criticality) ? raw.criticality : 'tier-2',
      lifecycle: isLifecycle(raw.lifecycle) ? raw.lifecycle : (prior?.lifecycle ?? 'planned'),
      owner: String(raw.owner || `${domain.name} team`),
      description: String(raw.description ?? ''),
    });
  }

  // Connections
  const resolve = (ref: string) => idMap.get(ref) ?? idMap.get(String(ref).toLowerCase()) ?? (componentIds.has(ref) ? ref : undefined);
  const seen = new Set<string>();
  const connections: Connection[] = [];
  for (const raw of draft.connections ?? []) {
    const from = resolve(String(raw.from));
    const to = resolve(String(raw.to));
    if (!from || !to) {
      notes.push(`Dropped a connection ${raw.from} → ${raw.to}: unknown component.`);
      continue;
    }
    const a = components.find((c) => c.id === from)!;
    const b = components.find((c) => c.id === to)!;
    let protocol: Protocol;
    if (isProtocol(raw.protocol)) protocol = raw.protocol;
    else {
      protocol = preferredProtocol(a.kind, b.kind) ?? 'https';
      notes.push(`Unknown protocol “${raw.protocol}” on ${a.name} → ${b.name}; used ${protocol}.`);
    }
    const key = `${from}>${to}>${protocol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const prior = previous?.connections.find((c) => c.from === from && c.to === to && c.protocol === protocol);
    connections.push({ id: prior?.id ?? uid('j'), from, to, protocol, label: String(raw.label ?? '') });
  }

  // Drop domains nobody uses.
  const usedDomains = new Set(components.map((c) => c.domainId));
  const keptDomains = domains.filter((d) => usedDomains.has(d.id));

  let design: Design = {
    id: previous?.id ?? uid('design'),
    name: String(draft.name || previous?.name || 'Untitled architecture'),
    summary: String(draft.summary ?? ''),
    prompt: opts.prompt,
    grid: previous?.grid ?? { w: 8, h: 6 },
    domains: keptDomains,
    components,
    connections,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };

  if (previous) {
    const unplaced = components.filter((c) => c.x < 0 || c.y < 0).map((c) => c.id);
    design = fitGrid(placeComponents(design, unplaced));
  } else {
    design = autoLayout(design);
  }
  return { design, notes };
}
