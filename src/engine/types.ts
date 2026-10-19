import type { ArchComponent, Category, ComponentKind, Connection, Protocol } from '../model/types';

export type Severity = 'error' | 'warning' | 'info';

export type RuleId =
  | 'weak-joint'
  | 'dangling-joint'
  | 'self-joint'
  | 'duplicate-joint'
  | 'floating-piece'
  | 'loose-island'
  | 'collision'
  | 'out-of-bounds'
  | 'unknown-domain'
  | 'bypasses-edge'
  | 'sync-cycle'
  | 'deep-sync-chain'
  | 'shared-store'
  | 'single-point-of-failure'
  | 'retiring-dependency'
  | 'planned-dependency'
  | 'unobserved-runtime'
  | 'no-observability'
  | 'unauthenticated-gateway'
  | 'unowned';

export type FixAction =
  | { type: 'set-replicas'; componentId: string; replicas: number }
  | { type: 'set-protocol'; connectionId: string; protocol: Protocol }
  | { type: 'auto-place'; componentIds: string[] }
  | { type: 'remove-connection'; connectionId: string }
  | { type: 'add-connection'; from: string; to: string; protocol: Protocol; label: string };

export interface Issue {
  id: string;
  rule: RuleId;
  severity: Severity;
  title: string;
  message: string;
  componentIds: string[];
  connectionIds: string[];
  fix?: { label: string; actions: FixAction[] };
}

export interface Joint {
  connectionId: string;
  status: 'strong' | 'weak';
  sync: boolean;
  reason?: string;
}

export interface PartLine {
  key: string;
  kind: ComponentKind;
  category: Category;
  tech: string;
  componentIds: string[];
  instances: number;
  domainIds: string[];
  monthlyCost: number;
}

export interface BuildStep {
  /** 1-based step number shown in the manual. */
  number: number;
  subBuildIndex: number;
  type: 'provision' | 'verify';
  title: string;
  adds: string[];
  wires: string[];
  instructions: string[];
  checks: string[];
}

export interface SubBuild {
  index: number;
  domainId: string;
  name: string;
  color: string;
  description: string;
  componentIds: string[];
  /** Indexes into `steps` (inclusive). */
  firstStep: number;
  lastStep: number;
}

export type ManualPage =
  | { kind: 'cover' }
  | { kind: 'inventory'; lines: PartLine[]; part: number; parts: number }
  | { kind: 'subbuild'; subBuildIndex: number }
  | { kind: 'step'; stepIndex: number }
  | { kind: 'final' };

export interface CompileStats {
  components: number;
  instances: number;
  joints: number;
  weakJoints: number;
  steps: number;
  pages: number;
  subBuilds: number;
  errors: number;
  warnings: number;
  infos: number;
  monthlyCost: number;
}

export interface DesignIndex {
  byId: Map<string, ArchComponent>;
  outgoing: Map<string, Connection[]>;
  incoming: Map<string, Connection[]>;
  connById: Map<string, Connection>;
}

export interface CompileResult {
  index: DesignIndex;
  joints: Map<string, Joint>;
  issues: Issue[];
  issuesByComponent: Map<string, Issue[]>;
  parts: PartLine[];
  subBuilds: SubBuild[];
  steps: BuildStep[];
  /** Step index (0-based) at which each component is installed. */
  installedAt: Map<string, number>;
  pages: ManualPage[];
  stats: CompileStats;
  ms: number;
}
