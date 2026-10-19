import { CATEGORY_INFO, KIND_INFO, PROTOCOL_INFO } from '../model/catalog';
import { COMPONENT_KINDS, CRITICALITIES, LIFECYCLES, PROTOCOLS, type Design, type DesignDraft } from '../model/types';
import type { Issue } from '../engine/types';

/** JSON schema Claude's structured output must follow (mirrors `DesignDraft`). */
export const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'summary', 'domains', 'components', 'connections'],
  properties: {
    name: { type: 'string', description: 'Short product-style name for the architecture' },
    summary: { type: 'string', description: 'One or two sentences on what was built and why' },
    domains: {
      type: 'array',
      description: 'Sub-builds (bounded contexts / districts)',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'description'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
    components: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'kind', 'tech', 'domain', 'replicas', 'criticality', 'lifecycle', 'owner', 'description'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string', enum: [...COMPONENT_KINDS] },
          tech: { type: 'string' },
          domain: { type: 'string', description: 'id of the domain this component belongs to' },
          replicas: { type: 'integer' },
          criticality: { type: 'string', enum: [...CRITICALITIES] },
          lifecycle: { type: 'string', enum: [...LIFECYCLES] },
          owner: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
    connections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to', 'protocol', 'label'],
        properties: {
          from: { type: 'string', description: 'id of the consuming component' },
          to: { type: 'string', description: 'id of the providing component' },
          protocol: { type: 'string', enum: [...PROTOCOLS] },
          label: { type: 'string' },
        },
      },
    },
  },
} as const;

function catalogTable(): string {
  const rows = COMPONENT_KINDS.map((kind) => {
    const k = KIND_INFO[kind];
    return `| ${kind} | ${k.category} | ${k.provides.join(', ') || '—'} | ${k.consumes.join(', ') || '—'} | ${k.techOptions.slice(0, 3).join(', ')} |`;
  });
  return ['| kind | category | provides | consumes | example tech |', '|---|---|---|---|---|', ...rows].join('\n');
}

export function systemPrompt(): string {
  const protocols = Object.entries(PROTOCOL_INFO)
    .map(([id, p]) => `${id} (${p.description}${p.sync ? ', synchronous' : ', asynchronous'})`)
    .join('; ');
  const categories = Object.entries(CATEGORY_INFO)
    .map(([id, c]) => `${id}: ${c.description}`)
    .join('; ');
  return `You are the design engine inside Arch Builder, an enterprise architecture tool. People describe a system (or attach a diagram or whiteboard photo) and you design it as components connected through interface contracts, grouped into domains. Think of it like a brick model: each component is a piece, the protocols it provides are its studs, and a connection is a joint.

Your design is compiled by a strict engine. It checks every joint, and the build only holds together when:
- A joint grips only when the protocol appears in the consumer's "consumes" list AND the provider's "provides" list. Direction: \`from\` is the caller or consumer, \`to\` is the provider. For event streams and queues, both producers and consumers point at the broker (label says "publishes …" or "consumes …").
- Every component has at least one joint, and all components form one connected structure. Pieces placed side by side in the same domain hold nothing together.
- Clients (web-app, mobile-app, device) reach the platform through cdn, api-gateway, bff, identity or iot-hub, never straight to services or data.
- Stores (relational-db, document-db, search-index, time-series-db) belong to one domain; other domains go through the owner's service or its events.
- tier-1 components outside the experience and external categories run at least 2 replicas.
- When an observability component exists, every api-gateway, bff, service, function, worker and workflow sends otlp to it. When an identity component exists, each api-gateway has an oidc joint to it.
- No synchronous call cycles, and no synchronous chain longer than 5 hops.

Component catalog:
${catalogTable()}

Categories: ${categories}.
Protocols: ${protocols}.

Conventions:
- ids are short, unique kebab-case; a component's \`domain\` is a domain id.
- Usually 4 to 12 domains and 15 to 50 components, scaled to what was asked. Shared plumbing (identity, secrets, observability, gateway, event backbone) goes in its own platform-style domains.
- Label every joint with what flows across it ("publishes order.placed", "reads balances").
- Pick realistic technologies that fit the request (cloud provider, language, vendors). Respect constraints the person states.
- owner is the accountable team. lifecycle is "planned" for new pieces; keep existing values when changing a build. Existing systems the person mentions are "live".
- summary: one or two plain sentences about what you built.`;
}

/** Strips layout and bookkeeping so Claude sees the build as a draft. */
export function designToDraft(design: Design): DesignDraft {
  return {
    name: design.name,
    summary: design.summary,
    domains: design.domains.map((d) => ({ id: d.id, name: d.name, description: d.description })),
    components: design.components.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      tech: c.tech,
      domain: c.domainId,
      replicas: c.replicas,
      criticality: c.criticality,
      lifecycle: c.lifecycle,
      owner: c.owner,
      description: c.description,
    })),
    connections: design.connections.map((c) => ({ from: c.from, to: c.to, protocol: c.protocol, label: c.label })),
  };
}

export function newBuildMessage(prompt: string, hasImage: boolean): string {
  return hasImage
    ? `Design this system. The attached image is a diagram, sketch or photo to work from; reproduce what it shows and complete whatever is missing so the build holds together.\n\nRequest: ${prompt || '(no text, use the image)'}`
    : `Design this system.\n\nRequest: ${prompt}`;
}

export function changeBuildMessage(prompt: string, current: Design, hasImage: boolean): string {
  return `Here is the current build:\n\n\`\`\`json\n${JSON.stringify(designToDraft(current), null, 1)}\n\`\`\`\n\nChange request: ${prompt}${
    hasImage ? '\n\nThe attached image shows what the person has in mind.' : ''
  }\n\nReturn the complete updated design. Keep the ids, names and settings of everything you were not asked to change.`;
}

export function repairMessage(issues: Issue[]): string {
  const lines = issues.map((i) => `- [${i.severity}] ${i.title}: ${i.message}`);
  return `The engine compiled your design and found these problems:\n${lines.join('\n')}\n\nReturn the corrected complete design. Change only what is needed to fix them.`;
}

export interface DesignerRequest {
  mode: 'new' | 'change';
  prompt: string;
  current?: Design | null;
  image?: { mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string } | null;
}

export type DesignerEvent =
  | { type: 'phase'; text: string }
  | { type: 'progress'; components: number; joints: number }
  | { type: 'result'; design: Design; notes: string[]; repairs: number }
  | { type: 'error'; message: string };
