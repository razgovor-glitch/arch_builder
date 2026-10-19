import { KIND_INFO, TELEMETRY_KINDS } from '../model/catalog';
import type { Design, DesignDraft, Protocol } from '../model/types';
import { slugify, titleCase, uniqueId } from '../model/util';
import { normalizeDraft } from '../ai/normalize';
import {
  CAPABILITY_TRIGGERS,
  CLOUD_TECH,
  GENERIC_TEMPLATE,
  KITS,
  LANGUAGE_TECH,
  SHARED_ALIASES,
  TEMPLATES,
  type Kit,
  type KitLink,
  type KitPart,
  type Template,
} from './blueprints';

const CLOUD_LABEL: Record<keyof typeof CLOUD_TECH, string> = { aws: 'AWS', azure: 'Azure', gcp: 'Google Cloud' };

export interface BlueprintPlan {
  template: Template;
  kits: Kit[];
  cloud: keyof typeof CLOUD_TECH | null;
  language: string | null;
  scale: 'mvp' | 'standard' | 'enterprise';
  mobile: boolean;
}

function matches(text: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text);
}

export function pickTemplate(text: string): Template {
  let best: Template = GENERIC_TEMPLATE;
  let bestScore = 0;
  for (const t of TEMPLATES) {
    const score = t.keywords.reduce((s, k) => s + (matches(text, k) ? 1 : 0), 0);
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

/** Decides which sub-builds a prompt calls for. */
export function planBlueprint(prompt: string): BlueprintPlan {
  const text = prompt.toLowerCase();
  const template = pickTemplate(text);
  const scale: BlueprintPlan['scale'] = /\bmvp\b|prototype|startup|\bsmall\b|\bsimple\b|\bpoc\b|proof of concept/.test(text)
    ? 'mvp'
    : /global|million|enterprise|high[- ]availability|mission[- ]critical|99\.9/.test(text)
      ? 'enterprise'
      : 'standard';
  const cloud = /\baws\b|amazon/.test(text) ? 'aws' : /azure|microsoft/.test(text) ? 'azure' : /\bgcp\b|google cloud/.test(text) ? 'gcp' : null;
  const language = LANGUAGE_TECH.find((l) => l.pattern.test(text))?.tech ?? null;
  const mobile = /mobile|\bios\b|android|\bapps?\b/.test(text);

  const kitIds: string[] = ['platform', 'edge', ...template.kits];
  if (scale !== 'mvp') kitIds.push(...template.defaults);
  for (const trigger of CAPABILITY_TRIGGERS) if (trigger.pattern.test(text)) kitIds.push(trigger.kit);

  // Pull in shared plumbing that any selected kit refers to.
  const selected = new Set(kitIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of [...selected]) {
      for (const l of KITS[id].links) {
        for (const ref of [l.from, l.to]) {
          const shared = SHARED_ALIASES[ref];
          if (shared && !selected.has(shared)) {
            selected.add(shared);
            grew = true;
          }
        }
      }
    }
  }
  // Every business kit publishes events; keep the backbone in the build.
  selected.add('integration');

  const order = ['platform', 'integration', 'edge', ...template.kits];
  const kits = [...selected]
    .sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 100 : ia) - (ib < 0 ? 100 : ib);
    })
    .map((id) => KITS[id]);
  return { template, kits, cloud, language, scale, mobile };
}

function channelsKit(plan: BlueprintPlan, hasIotHub: boolean): Kit {
  const specs = [...plan.template.channels];
  if (plan.mobile && plan.template.mobile && !specs.some((s) => s.kind === 'mobile-app')) specs.push(plan.template.mobile);
  if (plan.template.id === 'banking' && plan.template.mobile && !specs.some((s) => s.kind === 'mobile-app')) {
    specs.push(plan.template.mobile);
  }
  const parts: KitPart[] = specs.map((s) => ({ key: s.key, kind: s.kind, name: s.name, tech: s.tech }));
  const links: KitLink[] = [];
  for (const s of specs) {
    if (s.kind === 'web-app') {
      links.push(
        { from: s.key, to: '@cdn', protocol: 'https', label: 'loads app shell' },
        { from: s.key, to: '@gateway', protocol: 'https', label: 'API calls' },
        { from: s.key, to: '@identity', protocol: 'oidc', label: 'sign-in' },
      );
    } else if (s.kind === 'mobile-app') {
      links.push(
        { from: s.key, to: '@gateway', protocol: 'https', label: 'API calls' },
        { from: s.key, to: '@identity', protocol: 'oidc', label: 'sign-in' },
      );
    } else if (hasIotHub) {
      links.push(
        { from: s.key, to: '@iothub', protocol: 'mqtt', label: 'telemetry and commands' },
        { from: s.key, to: '@gateway', protocol: 'https', label: 'firmware downloads' },
      );
    } else {
      links.push({ from: s.key, to: '@gateway', protocol: 'https', label: 'device API' });
    }
  }
  return {
    id: 'channels',
    domain: 'Channels',
    description: 'The apps and devices people use to reach the platform.',
    parts,
    links,
  };
}

function nameFromPrompt(prompt: string, fallback: string): string {
  const quoted = prompt.match(/["“”']([^"“”']{3,60})["“”']/);
  if (quoted) return quoted[1].trim();
  const called = prompt.match(/\b(?:called|named)\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,4})/);
  if (called) return called[1].trim();
  return fallback;
}

/** Offline designer: composes kits into a draft that holds together. */
export function blueprintDraft(prompt: string): { draft: DesignDraft; plan: BlueprintPlan } {
  const plan = planBlueprint(prompt);
  const kits = [...plan.kits];
  const hasIotHub = kits.some((k) => k.parts.some((p) => p.alias === '@iothub'));
  kits.push(channelsKit(plan, hasIotHub));

  const draft: DesignDraft = {
    name: nameFromPrompt(prompt, plan.template.name),
    summary: '',
    domains: [],
    components: [],
    connections: [],
  };

  const takenIds = new Set<string>();
  const localIds = new Map<string, string>(); // `${kit}.${key}` -> component id
  const aliases = new Map<string, string>(); // `@alias` -> component id
  const kitOf = new Map<string, Kit>();

  for (const kit of kits) {
    const domainId = slugify(kit.domain);
    if (!draft.domains.some((d) => d.id === domainId)) {
      draft.domains.push({ id: domainId, name: kit.domain, description: kit.description });
    }
    for (const p of kit.parts) {
      let name = p.name;
      let tech = p.tech;
      if (kit.id === 'legacy' && p.kind === 'legacy-system' && plan.template.legacyName) {
        name = plan.template.legacyName.name;
        tech = plan.template.legacyName.tech;
      }
      if (!tech && plan.cloud) tech = CLOUD_TECH[plan.cloud][p.kind];
      if (!tech && plan.language && (p.kind === 'service' || p.kind === 'bff')) tech = plan.language;
      const info = KIND_INFO[p.kind];
      const tier = p.tier ?? 2;
      let replicas = p.replicas ?? defaultReplicas(p.kind);
      if (info.category === 'experience' || info.category === 'external') replicas = 1;
      else if (tier === 1) replicas = Math.max(replicas, plan.scale === 'enterprise' ? 3 : 2);
      else if (plan.scale === 'mvp') replicas = 1;
      const id = uniqueId(slugify(name), takenIds);
      localIds.set(`${kit.id}.${p.key}`, id);
      if (p.alias) aliases.set(p.alias, id);
      kitOf.set(id, kit);
      draft.components.push({
        id,
        name,
        kind: p.kind,
        tech: tech ?? info.defaultTech,
        domain: domainId,
        replicas,
        criticality: `tier-${tier}`,
        lifecycle: p.lifecycle ?? 'planned',
        owner: ownerFor(kit),
        description: p.description ?? '',
      });
    }
  }

  const seen = new Set<string>();
  const add = (from: string, to: string, protocol: Protocol, label: string) => {
    const key = `${from}>${to}>${protocol}`;
    if (seen.has(key) || from === to) return;
    seen.add(key);
    draft.connections.push({ from, to, protocol, label });
  };
  const resolve = (kit: Kit, ref: string) => (ref.startsWith('@') ? aliases.get(ref) : localIds.get(`${kit.id}.${ref}`));

  for (const kit of kits) {
    for (const l of kit.links) {
      const from = resolve(kit, l.from);
      const to = resolve(kit, l.to);
      if (!from || !to) continue; // optional or absent capability
      const fromKind = draft.components.find((c) => c.id === from)!.kind as keyof typeof KIND_INFO;
      const protocol = l.protocol ?? KIND_INFO[fromKind].consumes[0];
      add(from, to, protocol, l.label ?? '');
    }
    const gateway = aliases.get('@gateway');
    for (const key of kit.expose ?? []) {
      const target = localIds.get(`${kit.id}.${key}`);
      if (gateway && target) add(gateway, target, 'https', `routes /${slugify(kit.domain)}`);
    }
  }

  const observability = aliases.get('@observability');
  if (observability) {
    for (const c of draft.components) {
      if (TELEMETRY_KINDS.has(c.kind as keyof typeof KIND_INFO) && c.id !== observability) {
        add(c.id, observability, 'otlp', 'traces, metrics, logs');
      }
    }
  }

  const businessDomains = draft.domains
    .filter((d) => !['platform-security', 'edge-access', 'integration-backbone', 'channels'].includes(d.id))
    .map((d) => d.name);
  const extras = [
    plan.cloud ? `on ${CLOUD_LABEL[plan.cloud]}` : '',
    plan.language ? `services in ${plan.language}` : '',
    plan.scale === 'enterprise' ? 'tier-1 parts triple-replicated' : plan.scale === 'mvp' ? 'lean MVP footprint' : '',
  ].filter(Boolean);
  draft.summary = `${titleCase(plan.template.name)} with ${businessDomains.length} business sub-builds (${businessDomains.join(
    ', ',
  )}) on a shared platform, edge and event backbone${extras.length ? ` — ${extras.join(', ')}` : ''}.`;

  return { draft, plan };
}

function defaultReplicas(kind: keyof typeof KIND_INFO): number {
  switch (kind) {
    case 'event-stream':
      return 3;
    case 'cdn':
    case 'object-store':
    case 'data-warehouse':
    case 'observability':
    case 'function':
      return 1;
    default:
      return 2;
  }
}

function ownerFor(kit: Kit): string {
  switch (kit.id) {
    case 'platform':
    case 'edge':
    case 'integration':
      return 'Platform Engineering';
    case 'channels':
      return 'Digital Channels';
    default:
      return `${kit.domain} team`;
  }
}

export function generateBlueprint(prompt: string): { design: Design; plan: BlueprintPlan; notes: string[] } {
  const { draft, plan } = blueprintDraft(prompt);
  const { design, notes } = normalizeDraft(draft, { prompt });
  return { design, plan, notes };
}
