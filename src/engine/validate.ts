import {
  KIND_INFO,
  OWNED_STORE_KINDS,
  PROTOCOL_INFO,
  TELEMETRY_KINDS,
  categoryOf,
  compatibleProtocols,
} from '../model/catalog';
import type { ArchComponent, Connection, Design } from '../model/types';
import type { DesignIndex, FixAction, Issue, Joint, RuleId, Severity } from './types';

export function buildIndex(design: Design): DesignIndex {
  const byId = new Map<string, ArchComponent>();
  const outgoing = new Map<string, Connection[]>();
  const incoming = new Map<string, Connection[]>();
  const connById = new Map<string, Connection>();
  for (const c of design.components) {
    byId.set(c.id, c);
    outgoing.set(c.id, []);
    incoming.set(c.id, []);
  }
  for (const conn of design.connections) {
    connById.set(conn.id, conn);
    outgoing.get(conn.from)?.push(conn);
    incoming.get(conn.to)?.push(conn);
  }
  return { byId, outgoing, incoming, connById };
}

class IssueList {
  readonly items: Issue[] = [];
  add(
    rule: RuleId,
    severity: Severity,
    title: string,
    message: string,
    refs: { components?: string[]; connections?: string[] } = {},
    fix?: { label: string; actions: FixAction[] },
  ): void {
    const componentIds = refs.components ?? [];
    const connectionIds = refs.connections ?? [];
    this.items.push({
      id: `${rule}:${[...componentIds, ...connectionIds].join(',') || this.items.length}`,
      rule,
      severity,
      title,
      message,
      componentIds,
      connectionIds,
      fix,
    });
  }
}

/** Checks every connection: a joint only grips when the stud matches the socket. */
export function checkJoints(design: Design, index: DesignIndex): { joints: Map<string, Joint>; issues: Issue[] } {
  const joints = new Map<string, Joint>();
  const issues = new IssueList();
  const seen = new Map<string, string>();

  for (const conn of design.connections) {
    const from = index.byId.get(conn.from);
    const to = index.byId.get(conn.to);
    const sync = PROTOCOL_INFO[conn.protocol]?.sync ?? true;
    const pLabel = PROTOCOL_INFO[conn.protocol]?.label ?? conn.protocol;

    if (!from || !to) {
      joints.set(conn.id, { connectionId: conn.id, status: 'weak', sync, reason: 'Connects to a missing component' });
      issues.add(
        'dangling-joint',
        'error',
        'Dangling joint',
        `A ${pLabel} connection points at a component that no longer exists.`,
        { connections: [conn.id] },
        { label: 'Remove joint', actions: [{ type: 'remove-connection', connectionId: conn.id }] },
      );
      continue;
    }

    if (from.id === to.id) {
      joints.set(conn.id, { connectionId: conn.id, status: 'weak', sync, reason: 'Connects a component to itself' });
      issues.add(
        'self-joint',
        'error',
        'Self joint',
        `${from.name} is connected to itself.`,
        { components: [from.id], connections: [conn.id] },
        { label: 'Remove joint', actions: [{ type: 'remove-connection', connectionId: conn.id }] },
      );
      continue;
    }

    const dupKey = `${conn.from}>${conn.to}>${conn.protocol}`;
    const dupOf = seen.get(dupKey);
    if (dupOf) {
      issues.add(
        'duplicate-joint',
        'warning',
        'Duplicate joint',
        `${from.name} → ${to.name} over ${pLabel} is declared twice.`,
        { components: [from.id, to.id], connections: [conn.id] },
        { label: 'Remove duplicate', actions: [{ type: 'remove-connection', connectionId: conn.id }] },
      );
    } else {
      seen.set(dupKey, conn.id);
    }

    const toInfo = KIND_INFO[to.kind];
    const fromInfo = KIND_INFO[from.kind];
    const providerHasStud = toInfo.provides.includes(conn.protocol);
    const consumerHasSocket = fromInfo.consumes.includes(conn.protocol);

    if (!providerHasStud || !consumerHasSocket) {
      const reason = !providerHasStud
        ? `${to.name} has no ${pLabel} interface — it exposes ${
            toInfo.provides.map((p) => PROTOCOL_INFO[p].label).join(', ') || 'nothing (it is a client)'
          }`
        : `${from.name} (${fromInfo.label}) cannot speak ${pLabel}`;
      joints.set(conn.id, { connectionId: conn.id, status: 'weak', sync, reason });
      const options = compatibleProtocols(from.kind, to.kind);
      issues.add(
        'weak-joint',
        'error',
        'Weak joint',
        `${from.name} → ${to.name}: ${reason}. Side-by-side contact holds nothing; the interfaces must match.`,
        { components: [from.id, to.id], connections: [conn.id] },
        options.length
          ? {
              label: `Use ${PROTOCOL_INFO[options[0]].label}`,
              actions: [{ type: 'set-protocol', connectionId: conn.id, protocol: options[0] }],
            }
          : { label: 'Remove joint', actions: [{ type: 'remove-connection', connectionId: conn.id }] },
      );
      continue;
    }

    joints.set(conn.id, { connectionId: conn.id, status: 'strong', sync });

    const fromCat = categoryOf(from.kind);
    const toCat = categoryOf(to.kind);
    if (fromCat === 'experience' && toCat === 'application' && to.kind !== 'bff') {
      issues.add(
        'bypasses-edge',
        'warning',
        'Client bypasses the edge',
        `${from.name} calls ${to.name} directly. Route clients through an API gateway or BFF so auth, rate limits and versioning apply.`,
        { components: [from.id, to.id], connections: [conn.id] },
      );
    }

    if ((from.lifecycle === 'live' || from.lifecycle === 'build') && to.lifecycle === 'retiring') {
      issues.add(
        'retiring-dependency',
        'warning',
        'Depends on a retiring component',
        `${from.name} (${from.lifecycle}) depends on ${to.name}, which is being retired. Plan a migration path.`,
        { components: [from.id, to.id], connections: [conn.id] },
      );
    } else if (from.lifecycle === 'live' && to.lifecycle === 'planned') {
      issues.add(
        'planned-dependency',
        'info',
        'Live component waits on a planned one',
        `${from.name} is live but depends on ${to.name}, which is still planned.`,
        { components: [from.id, to.id], connections: [conn.id] },
      );
    }
  }

  return { joints, issues: issues.items };
}

/** Whole-structure checks: every piece attached, one connected model, sound placement. */
export function checkStructure(design: Design, index: DesignIndex, joints: Map<string, Joint>): Issue[] {
  const issues = new IssueList();
  const domainIds = new Set(design.domains.map((d) => d.id));
  const domainName = (id: string) => design.domains.find((d) => d.id === id)?.name ?? id;

  // Placement: bounds and collisions.
  const cells = new Map<string, string[]>();
  for (const c of design.components) {
    if (!domainIds.has(c.domainId)) {
      issues.add('unknown-domain', 'error', 'Component without a sub-build', `${c.name} belongs to a domain that does not exist.`, {
        components: [c.id],
      });
    }
    if (c.x < 0 || c.y < 0 || c.x >= design.grid.w || c.y >= design.grid.h) {
      issues.add(
        'out-of-bounds',
        'error',
        'Off the baseplate',
        `${c.name} sits outside the ${design.grid.w}×${design.grid.h} baseplate.`,
        { components: [c.id] },
        { label: 'Re-place', actions: [{ type: 'auto-place', componentIds: [c.id] }] },
      );
    }
    const key = `${c.x},${c.y}`;
    const list = cells.get(key) ?? [];
    list.push(c.id);
    cells.set(key, list);
  }
  for (const [key, ids] of cells) {
    if (ids.length < 2) continue;
    const names = ids.map((id) => index.byId.get(id)?.name ?? id);
    issues.add(
      'collision',
      'error',
      'Pieces collide',
      `${names.join(', ')} occupy the same cell (${key}).`,
      { components: ids },
      { label: 'Re-place', actions: [{ type: 'auto-place', componentIds: ids.slice(1) }] },
    );
  }

  // Attachment: floating pieces and loose islands (undirected connectivity over valid endpoints).
  const adjacency = new Map<string, Set<string>>();
  for (const c of design.components) adjacency.set(c.id, new Set());
  for (const conn of design.connections) {
    if (conn.from === conn.to) continue;
    if (!adjacency.has(conn.from) || !adjacency.has(conn.to)) continue;
    adjacency.get(conn.from)!.add(conn.to);
    adjacency.get(conn.to)!.add(conn.from);
  }
  const floating: string[] = [];
  for (const c of design.components) {
    if (adjacency.get(c.id)!.size === 0) {
      floating.push(c.id);
      issues.add(
        'floating-piece',
        'error',
        'Floating piece',
        `${c.name} sits in ${domainName(c.domainId)} but no interface connects it. Side-by-side contact holds nothing.`,
        { components: [c.id] },
      );
    }
  }
  const visited = new Set<string>(floating);
  const islands: string[][] = [];
  for (const c of design.components) {
    if (visited.has(c.id)) continue;
    const group: string[] = [];
    const stack = [c.id];
    visited.add(c.id);
    while (stack.length) {
      const id = stack.pop()!;
      group.push(id);
      for (const n of adjacency.get(id)!) {
        if (!visited.has(n)) {
          visited.add(n);
          stack.push(n);
        }
      }
    }
    islands.push(group);
  }
  if (islands.length > 1) {
    islands.sort((a, b) => b.length - a.length);
    for (const island of islands.slice(1)) {
      const names = island.map((id) => index.byId.get(id)!.name);
      issues.add(
        'loose-island',
        'error',
        'Loose sub-assembly',
        `${names.join(', ')} ${island.length === 1 ? 'is' : 'are'} connected to each other but not to the main structure.`,
        { components: island },
      );
    }
  }

  // Resilience.
  for (const c of design.components) {
    const cat = categoryOf(c.kind);
    if (c.criticality === 'tier-1' && c.replicas < 2 && cat !== 'experience' && cat !== 'external') {
      issues.add(
        'single-point-of-failure',
        'warning',
        'Single point of failure',
        `${c.name} is tier-1 but runs a single replica.`,
        { components: [c.id] },
        { label: 'Scale to 2 replicas', actions: [{ type: 'set-replicas', componentId: c.id, replicas: 2 }] },
      );
    }
    if (!c.owner.trim()) {
      issues.add('unowned', 'info', 'No owner', `${c.name} has no owning team.`, { components: [c.id] });
    }
  }

  // Data ownership: stores should only be touched by their own domain.
  for (const c of design.components) {
    if (!OWNED_STORE_KINDS.has(c.kind)) continue;
    const foreign = new Set<string>();
    const conns: string[] = [];
    for (const conn of index.incoming.get(c.id) ?? []) {
      const from = index.byId.get(conn.from);
      if (from && from.domainId !== c.domainId) {
        foreign.add(from.domainId);
        conns.push(conn.id);
      }
    }
    if (foreign.size) {
      issues.add(
        'shared-store',
        'warning',
        'Store shared across domains',
        `${c.name} (owned by ${domainName(c.domainId)}) is read directly by ${[...foreign]
          .map(domainName)
          .join(', ')}. Expose the data through the owning service or events instead.`,
        { components: [c.id], connections: conns },
      );
    }
  }

  // Observability and security plumbing.
  const observability = design.components.find((c) => c.kind === 'observability');
  const runtime = design.components.filter((c) => TELEMETRY_KINDS.has(c.kind));
  if (observability) {
    for (const c of runtime) {
      const emits = (index.outgoing.get(c.id) ?? []).some((conn) => conn.protocol === 'otlp');
      if (!emits) {
        issues.add(
          'unobserved-runtime',
          'warning',
          'Unobserved runtime',
          `${c.name} does not send telemetry to ${observability.name}.`,
          { components: [c.id] },
          {
            label: 'Connect telemetry',
            actions: [{ type: 'add-connection', from: c.id, to: observability.id, protocol: 'otlp', label: 'traces, metrics, logs' }],
          },
        );
      }
    }
  } else if (runtime.length >= 3) {
    issues.add(
      'no-observability',
      'info',
      'No observability stack',
      `${runtime.length} runtime components and nowhere to send traces, metrics or logs.`,
    );
  }

  const identity = design.components.find((c) => c.kind === 'identity');
  if (identity) {
    for (const gw of design.components.filter((c) => c.kind === 'api-gateway')) {
      const authed = (index.outgoing.get(gw.id) ?? []).some((conn) => conn.protocol === 'oidc');
      if (!authed) {
        issues.add(
          'unauthenticated-gateway',
          'warning',
          'Gateway does not validate tokens',
          `${gw.name} has no OIDC joint to ${identity.name}.`,
          { components: [gw.id] },
          {
            label: 'Connect to identity',
            actions: [{ type: 'add-connection', from: gw.id, to: identity.id, protocol: 'oidc', label: 'validates tokens' }],
          },
        );
      }
    }
  }

  // Synchronous call graph: cycles and deep chains.
  const syncEdges = new Map<string, string[]>();
  for (const c of design.components) syncEdges.set(c.id, []);
  for (const conn of design.connections) {
    const joint = joints.get(conn.id);
    if (!joint || joint.status !== 'strong' || !joint.sync) continue;
    syncEdges.get(conn.from)?.push(conn.to);
  }
  const sccs = stronglyConnected(syncEdges);
  const inCycle = new Set<string>();
  for (const scc of sccs) {
    if (scc.length < 2) continue;
    scc.forEach((id) => inCycle.add(id));
    issues.add(
      'sync-cycle',
      'warning',
      'Synchronous call cycle',
      `${scc.map((id) => index.byId.get(id)!.name).join(' ⇄ ')} call each other synchronously. A failure anywhere cascades; break the loop with events.`,
      { components: scc },
    );
  }
  const chain = longestChain(syncEdges, inCycle);
  if (chain.length - 1 > 5) {
    issues.add(
      'deep-sync-chain',
      'warning',
      'Deep synchronous chain',
      `${chain.length - 1} synchronous hops: ${chain.map((id) => index.byId.get(id)!.name).join(' → ')}. Latency and failure probability compound at every hop.`,
      { components: chain },
    );
  }

  return issues.items;
}

function stronglyConnected(graph: Map<string, string[]>): string[][] {
  let counter = 0;
  const indexOf = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];

  const visit = (v: string) => {
    indexOf.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!indexOf.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, indexOf.get(w)!));
      }
    }
    if (low.get(v) === indexOf.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      result.push(scc);
    }
  };

  for (const v of graph.keys()) if (!indexOf.has(v)) visit(v);
  return result;
}

function longestChain(graph: Map<string, string[]>, exclude: Set<string>): string[] {
  const memo = new Map<string, string[]>();
  const walk = (v: string): string[] => {
    const cached = memo.get(v);
    if (cached) return cached;
    let best: string[] = [v];
    for (const w of graph.get(v) ?? []) {
      if (exclude.has(w) || w === v) continue;
      const sub = walk(w);
      if (sub.length + 1 > best.length) best = [v, ...sub];
    }
    memo.set(v, best);
    return best;
  };
  let best: string[] = [];
  for (const v of graph.keys()) {
    if (exclude.has(v)) continue;
    const chain = walk(v);
    if (chain.length > best.length) best = chain;
  }
  return best;
}
