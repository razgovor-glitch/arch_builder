import { DOMAIN_COLORS, KIND_INFO, preferredProtocol } from '../model/catalog';
import type { ArchComponent, ComponentKind, Connection, Design, Domain, Protocol } from '../model/types';
import { nowIso, slugify, uid, uniqueId } from '../model/util';
import { fitGrid, placeComponents } from './layout';
import type { FixAction } from './types';

/** Pure helpers that return a new design; the store and the offline editor share them. */

export function touch(design: Design): Design {
  return { ...design, updatedAt: nowIso() };
}

export function nextDomainColor(design: Design): string {
  const used = new Set(design.domains.map((d) => d.color));
  return DOMAIN_COLORS.find((c) => !used.has(c)) ?? DOMAIN_COLORS[design.domains.length % DOMAIN_COLORS.length];
}

export function addDomain(design: Design, name: string, description = ''): { design: Design; domain: Domain } {
  const taken = new Set(design.domains.map((d) => d.id));
  const domain: Domain = { id: uniqueId(slugify(name), taken), name, color: nextDomainColor(design), description };
  return { design: touch({ ...design, domains: [...design.domains, domain] }), domain };
}

export function addComponent(
  design: Design,
  input: Partial<ArchComponent> & { kind: ComponentKind; domainId: string },
  at?: { x: number; y: number },
): { design: Design; component: ArchComponent } {
  const info = KIND_INFO[input.kind];
  const taken = new Set(design.components.map((c) => c.id));
  const name = input.name ?? `${info.label} ${design.components.filter((c) => c.kind === input.kind).length + 1}`;
  const domain = design.domains.find((d) => d.id === input.domainId);
  const component: ArchComponent = {
    id: input.id && !taken.has(input.id) ? input.id : uniqueId(slugify(name), taken),
    name,
    kind: input.kind,
    tech: input.tech ?? info.defaultTech,
    domainId: input.domainId,
    x: at?.x ?? -1,
    y: at?.y ?? -1,
    replicas: input.replicas ?? (info.category === 'experience' || info.category === 'external' ? 1 : 2),
    criticality: input.criticality ?? 'tier-2',
    lifecycle: input.lifecycle ?? 'planned',
    owner: input.owner ?? (domain ? `${domain.name} team` : ''),
    description: input.description ?? '',
  };
  let next: Design = { ...design, components: [...design.components, component] };
  const occupied = at && design.components.some((c) => c.x === at.x && c.y === at.y);
  if (!at || occupied) next = placeComponents(next, [component.id]);
  else next = growToFit(next);
  const placed = next.components.find((c) => c.id === component.id)!;
  return { design: touch(next), component: placed };
}

export function growToFit(design: Design): Design {
  const maxX = Math.max(0, ...design.components.map((c) => c.x));
  const maxY = Math.max(0, ...design.components.map((c) => c.y));
  return { ...design, grid: { w: Math.max(design.grid.w, maxX + 2), h: Math.max(design.grid.h, maxY + 2) } };
}

export function updateComponent(design: Design, id: string, patch: Partial<ArchComponent>): Design {
  return touch({ ...design, components: design.components.map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c)) });
}

export function removeComponents(design: Design, ids: string[]): Design {
  const gone = new Set(ids);
  return touch({
    ...design,
    components: design.components.filter((c) => !gone.has(c.id)),
    connections: design.connections.filter((conn) => !gone.has(conn.from) && !gone.has(conn.to)),
  });
}

export function connect(
  design: Design,
  from: string,
  to: string,
  protocol?: Protocol,
  label = '',
): { design: Design; connection: Connection | null } {
  const a = design.components.find((c) => c.id === from);
  const b = design.components.find((c) => c.id === to);
  if (!a || !b || a.id === b.id) return { design, connection: null };
  const chosen = protocol ?? preferredProtocol(a.kind, b.kind) ?? KIND_INFO[b.kind].provides[0] ?? 'https';
  const existing = design.connections.find((c) => c.from === from && c.to === to && c.protocol === chosen);
  if (existing) return { design, connection: existing };
  const connection: Connection = { id: uid('j'), from, to, protocol: chosen, label };
  return { design: touch({ ...design, connections: [...design.connections, connection] }), connection };
}

export function updateConnection(design: Design, id: string, patch: Partial<Connection>): Design {
  return touch({ ...design, connections: design.connections.map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c)) });
}

export function removeConnections(design: Design, ids: string[]): Design {
  const gone = new Set(ids);
  return touch({ ...design, connections: design.connections.filter((c) => !gone.has(c.id)) });
}

export function updateDomain(design: Design, id: string, patch: Partial<Domain>): Design {
  return touch({ ...design, domains: design.domains.map((d) => (d.id === id ? { ...d, ...patch, id: d.id } : d)) });
}

/** Removes a domain; its components move to `moveTo` (or are removed when no target is given). */
export function removeDomain(design: Design, id: string, moveTo?: string): Design {
  const members = design.components.filter((c) => c.domainId === id).map((c) => c.id);
  let next: Design = { ...design, domains: design.domains.filter((d) => d.id !== id) };
  if (moveTo) {
    next = { ...next, components: next.components.map((c) => (c.domainId === id ? { ...c, domainId: moveTo } : c)) };
  } else {
    next = removeComponents(next, members);
  }
  return touch(next);
}

/** Moves every component of a domain by a cell offset; refuses when it would collide. */
export function moveDomain(design: Design, id: string, dx: number, dy: number): Design | null {
  if (!dx && !dy) return design;
  const members = new Set(design.components.filter((c) => c.domainId === id).map((c) => c.id));
  const others = new Set(design.components.filter((c) => !members.has(c.id)).map((c) => `${c.x},${c.y}`));
  const moved = design.components.map((c) => (members.has(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c));
  if (moved.some((c) => members.has(c.id) && (others.has(`${c.x},${c.y}`) || c.x < 0 || c.y < 0))) return null;
  return touch(fitGrid({ ...design, components: moved }));
}

/** Moves one component to a cell, swapping with whatever is there. */
export function moveComponent(design: Design, id: string, x: number, y: number): Design {
  const comp = design.components.find((c) => c.id === id);
  if (!comp || (comp.x === x && comp.y === y)) return design;
  const occupant = design.components.find((c) => c.x === x && c.y === y && c.id !== id);
  const components = design.components.map((c) => {
    if (c.id === id) return { ...c, x, y };
    if (occupant && c.id === occupant.id) return { ...c, x: comp.x, y: comp.y };
    return c;
  });
  return touch(fitGrid({ ...design, components }));
}

export function applyFix(design: Design, actions: FixAction[]): Design {
  let next = design;
  for (const action of actions) {
    switch (action.type) {
      case 'set-replicas':
        next = updateComponent(next, action.componentId, { replicas: action.replicas });
        break;
      case 'set-protocol':
        next = updateConnection(next, action.connectionId, { protocol: action.protocol });
        break;
      case 'remove-connection':
        next = removeConnections(next, [action.connectionId]);
        break;
      case 'auto-place':
        next = touch(placeComponents(next, action.componentIds));
        break;
      case 'add-connection':
        next = connect(next, action.from, action.to, action.protocol, action.label).design;
        break;
    }
  }
  return next;
}

export function emptyDesign(name = 'Untitled architecture'): Design {
  const now = nowIso();
  return {
    id: uid('design'),
    name,
    summary: '',
    prompt: '',
    grid: { w: 8, h: 6 },
    domains: [],
    components: [],
    connections: [],
    createdAt: now,
    updatedAt: now,
  };
}
