import { KIND_INFO, PROTOCOL_INFO, categoryOf } from '../model/catalog';
import type { ArchComponent, Category, Connection, Design } from '../model/types';
import type { BuildStep, DesignIndex, Joint, SubBuild } from './types';

/** Among components that are free to build, providers of shared plumbing go first. */
const BUILD_PRIORITY: Record<Category, number> = {
  platform: 0,
  data: 1,
  integration: 2,
  external: 3,
  application: 4,
  edge: 5,
  experience: 6,
};

/**
 * Kahn's algorithm with deterministic tie-breaking. When a cycle blocks progress,
 * the node with the fewest unresolved dependencies is released first.
 */
function orderByDependencies<T>(
  nodes: T[],
  key: (n: T) => string,
  dependsOn: (n: T) => string[],
  compare: (a: T, b: T) => number,
): T[] {
  const ids = new Set(nodes.map(key));
  const pending = new Map<string, Set<string>>();
  for (const n of nodes) {
    pending.set(key(n), new Set(dependsOn(n).filter((d) => ids.has(d) && d !== key(n))));
  }
  const done = new Set<string>();
  const result: T[] = [];
  let remaining = [...nodes];
  while (remaining.length) {
    const ready = remaining.filter((n) => [...pending.get(key(n))!].every((d) => done.has(d)));
    let next: T;
    if (ready.length) {
      next = ready.sort(compare)[0];
    } else {
      next = [...remaining].sort((a, b) => {
        const ua = [...pending.get(key(a))!].filter((d) => !done.has(d)).length;
        const ub = [...pending.get(key(b))!].filter((d) => !done.has(d)).length;
        return ua - ub || compare(a, b);
      })[0];
    }
    result.push(next);
    done.add(key(next));
    remaining = remaining.filter((n) => n !== next);
  }
  return result;
}

/**
 * Sub-build order: a domain comes after the domains it depends on, so shared
 * providers (platform, backbone) go first and channels last. Also used to lay
 * districts out back-to-front on the baseplate.
 */
export function orderDomains(design: Design): string[] {
  const order = new Map(design.domains.map((d, i) => [d.id, i]));
  const members = new Map<string, ArchComponent[]>();
  for (const d of design.domains) members.set(d.id, []);
  for (const c of design.components) {
    if (!members.has(c.domainId)) members.set(c.domainId, []);
    members.get(c.domainId)!.push(c);
  }
  const byId = new Map(design.components.map((c) => [c.id, c]));
  const deps = new Map<string, Set<string>>();
  for (const id of members.keys()) deps.set(id, new Set());
  for (const conn of design.connections) {
    const from = byId.get(conn.from);
    const to = byId.get(conn.to);
    if (from && to && from.domainId !== to.domainId) deps.get(from.domainId)?.add(to.domainId);
  }
  const avgPriority = (id: string) => {
    const list = members.get(id)!;
    if (!list.length) return 99;
    return list.reduce((s, c) => s + BUILD_PRIORITY[categoryOf(c.kind)], 0) / list.length;
  };
  return orderByDependencies(
    [...members.keys()],
    (id) => id,
    (id) => [...deps.get(id)!],
    (a, b) => avgPriority(a) - avgPriority(b) || (order.get(a) ?? 99) - (order.get(b) ?? 99),
  );
}

const CHECKS: Partial<Record<ArchComponent['kind'], (c: ArchComponent) => string[]>> = {
  'web-app': () => ['Smoke-test sign-in and the primary user journey'],
  'mobile-app': () => ['Smoke-test sign-in on iOS and Android test builds'],
  device: () => ['Provision a test device with its client certificate'],
  cdn: () => ['TLS certificate valid; cache rules return expected hit ratio'],
  'api-gateway': () => ['Routes published; rate limits and WAF rules enabled'],
  'load-balancer': () => ['Health checks green for every target'],
  bff: (c) => [`Health check returns 200 on all ${c.replicas} replicas`, 'Schema/contract tests pass'],
  service: (c) => [`Health check returns 200 on all ${c.replicas} replicas`, 'Contract tests pass for every exposed interface'],
  function: () => ['Test invocation succeeds; cold start under 1 s'],
  worker: () => ['A test message is processed end to end and acknowledged'],
  workflow: () => ['Sample workflow completes, including a compensation path'],
  'message-queue': () => ['Dead-letter queue and retry policy configured'],
  'event-stream': (c) => [`Topics created with replication factor ${Math.min(3, Math.max(1, c.replicas))}`, 'Schema registry subjects registered'],
  'integration-hub': () => ['Message flow tested end to end with a sample payload'],
  'iot-hub': () => ['Test device connects, publishes and receives a command'],
  'relational-db': (c) => ['Backups scheduled and a restore rehearsed', ...(c.replicas > 1 ? [`Replication healthy across ${c.replicas} nodes`] : [])],
  'document-db': (c) => ['Backups scheduled and a restore rehearsed', ...(c.replicas > 1 ? [`Replica set healthy (${c.replicas} members)`] : [])],
  'time-series-db': () => ['Retention and downsampling policies applied'],
  cache: () => ['Eviction policy and TTLs configured'],
  'object-store': () => ['Encryption, versioning and lifecycle rules applied'],
  'search-index': () => ['Index mappings applied; a test query returns results'],
  'data-warehouse': () => ['Ingestion jobs scheduled; access roles granted'],
  'ml-model': () => ['Model version pinned; p95 inference latency within SLO'],
  identity: () => ['OIDC discovery endpoint reachable; MFA policy enforced'],
  observability: () => ['Dashboards and alert routes provisioned'],
  secrets: () => ['Vault unsealed; least-privilege policies applied'],
  'external-saas': () => ['Sandbox credentials verified; contract and SLA on file'],
  'partner-api': () => ['Partner connectivity and credentials verified'],
  'legacy-system': () => ['Connectivity verified with the owning team (VPN / MQ / file drop)'],
};

function provisionInstructions(c: ArchComponent, design: Design): string[] {
  const info = KIND_INFO[c.kind];
  const domain = design.domains.find((d) => d.id === c.domainId)?.name ?? 'its domain';
  const cat = categoryOf(c.kind);
  const lines: string[] = [];
  if (cat === 'external') {
    lines.push(`Onboard ${c.tech} as “${c.name}” and record the contract owner (${c.owner || 'unassigned'}).`);
  } else if (cat === 'experience') {
    lines.push(`Build and publish ${c.name} (${c.tech}) from the ${domain} repository.`);
  } else {
    const count = c.replicas > 1 ? `${c.replicas} replicas` : 'a single instance';
    lines.push(`Provision ${c.name} (${c.tech}) in ${domain} with ${count}.`);
  }
  if (info.provides.length) {
    const studs = info.provides.map((p) => PROTOCOL_INFO[p].label);
    lines.push(`Expose its ${studs.join(', ')} interface${studs.length > 1 ? 's' : ''} for consumers.`);
  }
  if (c.criticality === 'tier-1' && cat !== 'external' && cat !== 'experience') {
    lines.push('Tier-1: spread replicas across availability zones and page on-call on failure.');
  }
  return lines;
}

function wireInstruction(conn: Connection, index: DesignIndex): string {
  const from = index.byId.get(conn.from)!;
  const to = index.byId.get(conn.to)!;
  const label = conn.label ? ` — ${conn.label}` : '';
  return `Connect ${from.name} → ${to.name} over ${PROTOCOL_INFO[conn.protocol]?.label ?? conn.protocol}${label}.`;
}

export function planBuild(
  design: Design,
  index: DesignIndex,
  joints: Map<string, Joint>,
): { subBuilds: SubBuild[]; steps: BuildStep[]; installedAt: Map<string, number> } {
  const membersOf = new Map<string, ArchComponent[]>();
  for (const d of design.domains) membersOf.set(d.id, []);
  for (const c of design.components) {
    if (!membersOf.has(c.domainId)) membersOf.set(c.domainId, []);
    membersOf.get(c.domainId)!.push(c);
  }

  const orderedDomains = orderDomains(design).filter((id) => (membersOf.get(id)?.length ?? 0) > 0);

  const steps: BuildStep[] = [];
  const subBuilds: SubBuild[] = [];
  const installed = new Set<string>();
  const installedAt = new Map<string, number>();
  const wired = new Set<string>();

  orderedDomains.forEach((domainId, subIndex) => {
    const domain = design.domains.find((d) => d.id === domainId);
    const members = orderByDependencies(
      membersOf.get(domainId)!,
      (c) => c.id,
      (c) => (index.outgoing.get(c.id) ?? []).map((conn) => conn.to),
      (a, b) =>
        BUILD_PRIORITY[categoryOf(a.kind)] - BUILD_PRIORITY[categoryOf(b.kind)] || a.y - b.y || a.x - b.x || a.name.localeCompare(b.name),
    );
    const firstStep = steps.length;
    const domainWires: string[] = [];

    for (const c of members) {
      installed.add(c.id);
      installedAt.set(c.id, steps.length);
      const conns = [...(index.outgoing.get(c.id) ?? []), ...(index.incoming.get(c.id) ?? [])].filter(
        (conn) => !wired.has(conn.id) && installed.has(conn.from) && installed.has(conn.to),
      );
      conns.forEach((conn) => wired.add(conn.id));
      domainWires.push(...conns.map((conn) => conn.id));
      const weak = conns.filter((conn) => joints.get(conn.id)?.status === 'weak');
      steps.push({
        number: steps.length + 1,
        subBuildIndex: subIndex,
        type: 'provision',
        title: `${categoryOf(c.kind) === 'external' ? 'Onboard' : 'Install'} ${c.name}`,
        adds: [c.id],
        wires: conns.map((conn) => conn.id),
        instructions: [...provisionInstructions(c, design), ...conns.map((conn) => wireInstruction(conn, index))],
        checks: [
          ...(CHECKS[c.kind]?.(c) ?? []),
          ...weak.map((conn) => `⚠ Weak joint: ${joints.get(conn.id)?.reason ?? 'interfaces do not match'}`),
        ],
      });
    }

    if (members.length >= 2) {
      const strong = domainWires.filter((id) => joints.get(id)?.status === 'strong').length;
      steps.push({
        number: steps.length + 1,
        subBuildIndex: subIndex,
        type: 'verify',
        title: `Checkpoint — ${domain?.name ?? domainId}`,
        adds: [],
        wires: [],
        instructions: [
          `Run the ${domain?.name ?? domainId} sub-build smoke suite in staging.`,
          `Confirm dashboards and alerts exist for ${members.length} components.`,
        ],
        checks: [
          `${strong} of ${domainWires.length} joints verified end to end`,
          'Runbook and on-call rotation published',
          'Security review signed off',
        ],
      });
    }

    subBuilds.push({
      index: subIndex,
      domainId,
      name: domain?.name ?? domainId,
      color: domain?.color ?? '#888888',
      description: domain?.description ?? '',
      componentIds: members.map((m) => m.id),
      firstStep,
      lastStep: steps.length - 1,
    });
  });

  return { subBuilds, steps, installedAt };
}
