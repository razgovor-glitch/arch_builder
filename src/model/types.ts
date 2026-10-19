/**
 * Core architecture model.
 *
 * The brick metaphor: every component is a piece placed on a grid baseplate,
 * the interfaces it exposes are its studs, and a connection only "grips" when
 * the consumer speaks a protocol the provider actually exposes. Components that
 * merely sit next to each other in the same domain hold nothing together.
 */

export const PROTOCOLS = [
  'https',
  'grpc',
  'graphql',
  'websocket',
  'sql',
  'nosql',
  'kv',
  'search',
  'blob',
  'amqp',
  'kafka',
  'mqtt',
  'oidc',
  'smtp',
  'otlp',
  'sftp',
  'hl7',
] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export const CATEGORIES = [
  'experience',
  'edge',
  'application',
  'integration',
  'data',
  'platform',
  'external',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const COMPONENT_KINDS = [
  'web-app',
  'mobile-app',
  'device',
  'cdn',
  'api-gateway',
  'load-balancer',
  'bff',
  'service',
  'function',
  'worker',
  'workflow',
  'message-queue',
  'event-stream',
  'integration-hub',
  'iot-hub',
  'relational-db',
  'document-db',
  'cache',
  'object-store',
  'search-index',
  'time-series-db',
  'data-warehouse',
  'ml-model',
  'identity',
  'observability',
  'secrets',
  'external-saas',
  'partner-api',
  'legacy-system',
] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const CRITICALITIES = ['tier-1', 'tier-2', 'tier-3'] as const;
export type Criticality = (typeof CRITICALITIES)[number];

export const LIFECYCLES = ['planned', 'build', 'live', 'retiring'] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

export interface Domain {
  id: string;
  name: string;
  color: string;
  description: string;
}

export interface ArchComponent {
  id: string;
  name: string;
  kind: ComponentKind;
  tech: string;
  domainId: string;
  /** Grid cell on the baseplate. */
  x: number;
  y: number;
  replicas: number;
  criticality: Criticality;
  lifecycle: Lifecycle;
  owner: string;
  description: string;
}

/** A directed dependency: `from` consumes an interface that `to` provides. */
export interface Connection {
  id: string;
  from: string;
  to: string;
  protocol: Protocol;
  label: string;
}

export interface Design {
  id: string;
  name: string;
  summary: string;
  prompt: string;
  grid: { w: number; h: number };
  domains: Domain[];
  components: ArchComponent[];
  connections: Connection[];
  createdAt: string;
  updatedAt: string;
}

export type DesignSource = 'claude' | 'blueprint' | 'manual' | 'import';

export interface Version {
  id: string;
  label: string;
  createdAt: string;
  source: DesignSource;
  design: Design;
}

export interface ChatResult {
  versionId: string;
  title: string;
  summary: string;
  components: number;
  steps: number;
  domains: number;
  joints: number;
  weakJoints: number;
  grid: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  engine?: 'claude' | 'blueprint';
  status?: 'working' | 'done' | 'error';
  phases?: string[];
  result?: ChatResult;
  imageName?: string;
}

export interface Build {
  id: string;
  name: string;
  design: Design;
  versions: Version[];
  chat: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

/** What Claude (or the blueprint engine) produces before layout and normalization. */
export interface DesignDraft {
  name: string;
  summary: string;
  domains: { id: string; name: string; description: string }[];
  components: {
    id: string;
    name: string;
    kind: string;
    tech: string;
    domain: string;
    replicas: number;
    criticality: string;
    lifecycle: string;
    owner: string;
    description: string;
  }[];
  connections: { from: string; to: string; protocol: string; label: string }[];
}
