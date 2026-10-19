import type { ReactNode } from 'react';
import { CATEGORY_INFO, DOMAIN_COLORS, KIND_INFO, PROTOCOL_INFO, compatibleProtocols } from '../model/catalog';
import { COMPONENT_KINDS, CRITICALITIES, LIFECYCLES, PROTOCOLS, type ArchComponent, type ComponentKind, type Connection, type Domain, type Protocol } from '../model/types';
import { formatMoney, pluralize } from '../model/util';
import { applyFix, removeComponents, removeConnections, removeDomain, updateComponent, updateConnection, updateDomain } from '../engine/ops';
import type { Issue } from '../engine/types';
import { BrickIcon } from '../iso/BrickIcon';
import { useStore } from '../store/store';
import { Segmented, useWorkspace } from './common';
import { IconAlert, IconInfo, IconTrash, IconWand, IconX, IconXCircle } from './icons';

export function Inspector() {
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const { design } = useWorkspace();
  if (!selection) return null;
  let body: ReactNode = null;
  if (selection.type === 'component') {
    const c = design.components.find((x) => x.id === selection.id);
    if (c) body = <ComponentPanel c={c} />;
  } else if (selection.type === 'connection') {
    const conn = design.connections.find((x) => x.id === selection.id);
    if (conn) body = <ConnectionPanel conn={conn} />;
  } else {
    const d = design.domains.find((x) => x.id === selection.id);
    if (d) body = <DomainPanel d={d} />;
  }
  if (!body) return null;
  return (
    <aside className="inspector" aria-label="Inspector">
      <button type="button" className="icon-btn inspector-close" onClick={() => select(null)} title="Close (Esc)">
        <IconX size={16} />
      </button>
      {body}
    </aside>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  const commit = useStore((s) => s.commit);
  if (!issues.length) return null;
  return (
    <div className="insp-issues">
      {issues.map((i) => (
        <div key={i.id} className={`insp-issue sev-${i.severity}`}>
          {i.severity === 'error' ? <IconXCircle size={14} /> : i.severity === 'warning' ? <IconAlert size={14} /> : <IconInfo size={14} />}
          <div>
            <div className="insp-issue-title">{i.title}</div>
            <div className="insp-issue-msg">{i.message}</div>
            {i.fix && (
              <button type="button" className="btn btn-xs btn-soft" onClick={() => commit((d) => applyFix(d, i.fix!.actions))}>
                <IconWand size={12} /> {i.fix.label}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ComponentPanel({ c }: { c: ArchComponent }) {
  const { design, compiled } = useWorkspace();
  const commit = useStore((s) => s.commit);
  const select = useStore((s) => s.select);
  const info = KIND_INFO[c.kind];
  const set = (patch: Partial<ArchComponent>, key?: string) => commit((d) => updateComponent(d, c.id, patch), key ? { coalesce: `${c.id}:${key}` } : undefined);
  const incoming = compiled.index.incoming.get(c.id) ?? [];
  const outgoing = compiled.index.outgoing.get(c.id) ?? [];
  const name = (id: string) => compiled.index.byId.get(id)?.name ?? id;

  return (
    <div className="insp">
      <div className="insp-head">
        <BrickIcon kind={c.kind} replicas={c.replicas} size={48} />
        <div>
          <div className="insp-kicker" style={{ color: CATEGORY_INFO[info.category].color }}>
            {CATEGORY_INFO[info.category].label} · {info.label}
          </div>
          <input className="insp-title" value={c.name} onChange={(e) => set({ name: e.target.value }, 'name')} aria-label="Name" />
        </div>
      </div>

      <IssueList issues={compiled.issuesByComponent.get(c.id) ?? []} />

      <div className="insp-grid">
        <Field label="Kind">
          <select className="select" value={c.kind} onChange={(e) => set({ kind: e.target.value as ComponentKind, tech: KIND_INFO[e.target.value as ComponentKind].defaultTech })}>
            {COMPONENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {CATEGORY_INFO[KIND_INFO[k].category].label} — {KIND_INFO[k].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Technology">
          <input className="input" list={`tech-${c.kind}`} value={c.tech} onChange={(e) => set({ tech: e.target.value }, 'tech')} />
          <datalist id={`tech-${c.kind}`}>
            {info.techOptions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field label="Sub-build">
          <select className="select" value={c.domainId} onChange={(e) => set({ domainId: e.target.value })}>
            {design.domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Owner">
          <input className="input" value={c.owner} onChange={(e) => set({ owner: e.target.value }, 'owner')} placeholder="Owning team" />
        </Field>
        <Field label="Criticality">
          <Segmented size="sm" value={c.criticality} onChange={(v) => set({ criticality: v })} options={CRITICALITIES.map((t) => ({ value: t, label: t.replace('tier-', 'Tier ') }))} />
        </Field>
        <Field label="Lifecycle">
          <Segmented size="sm" value={c.lifecycle} onChange={(v) => set({ lifecycle: v })} options={LIFECYCLES.map((l) => ({ value: l, label: l }))} />
        </Field>
        <Field label="Replicas" hint={`≈ ${formatMoney(c.replicas * info.costPerReplica)}/month`}>
          <div className="stepper">
            <button type="button" onClick={() => set({ replicas: Math.max(1, c.replicas - 1) })} aria-label="Fewer replicas">
              −
            </button>
            <span>{c.replicas}</span>
            <button type="button" onClick={() => set({ replicas: Math.min(12, c.replicas + 1) })} aria-label="More replicas">
              +
            </button>
          </div>
        </Field>
        <Field label="Description">
          <textarea className="input" rows={2} value={c.description} onChange={(e) => set({ description: e.target.value }, 'desc')} placeholder="What it does, SLAs, notes…" />
        </Field>
      </div>

      <div className="insp-section">
        <div className="insp-section-title">Studs — interfaces it provides</div>
        <div className="proto-row">
          {info.provides.length ? (
            info.provides.map((p) => (
              <span key={p} className="proto" style={{ ['--proto' as string]: PROTOCOL_INFO[p].color }}>
                {PROTOCOL_INFO[p].label}
              </span>
            ))
          ) : (
            <span className="muted">None — a smooth tile; nothing can depend on it.</span>
          )}
        </div>
        <div className="insp-section-title">Sockets — protocols it can consume</div>
        <div className="proto-row">
          {info.consumes.length ? (
            info.consumes.map((p) => (
              <span key={p} className="proto proto-outline" style={{ ['--proto' as string]: PROTOCOL_INFO[p].color }}>
                {PROTOCOL_INFO[p].label}
              </span>
            ))
          ) : (
            <span className="muted">None — it only serves.</span>
          )}
        </div>
      </div>

      <div className="insp-section">
        <div className="insp-section-title">
          Joints · {pluralize(outgoing.length, 'dependency', 'dependencies')}, {pluralize(incoming.length, 'consumer')}
        </div>
        <ul className="joint-list">
          {outgoing.map((conn) => (
            <JointRow key={conn.id} conn={conn} label={`→ ${name(conn.to)}`} onClick={() => select({ type: 'connection', id: conn.id })} />
          ))}
          {incoming.map((conn) => (
            <JointRow key={conn.id} conn={conn} label={`← ${name(conn.from)}`} onClick={() => select({ type: 'connection', id: conn.id })} />
          ))}
        </ul>
      </div>

      <button
        type="button"
        className="btn btn-danger btn-sm"
        onClick={() => {
          commit((d) => removeComponents(d, [c.id]));
          select(null);
        }}
      >
        <IconTrash size={14} /> Remove component
      </button>
    </div>
  );
}

function JointRow({ conn, label, onClick }: { conn: Connection; label: string; onClick: () => void }) {
  const { compiled } = useWorkspace();
  const weak = compiled.joints.get(conn.id)?.status === 'weak';
  return (
    <li>
      <button type="button" className={`joint-row${weak ? ' is-weak' : ''}`} onClick={onClick}>
        <span className="proto" style={{ ['--proto' as string]: weak ? '#e5484d' : PROTOCOL_INFO[conn.protocol].color }}>
          {PROTOCOL_INFO[conn.protocol].label}
        </span>
        <span className="joint-row-name">{label}</span>
        {conn.label && <span className="joint-row-label">{conn.label}</span>}
      </button>
    </li>
  );
}

function ConnectionPanel({ conn }: { conn: Connection }) {
  const { compiled } = useWorkspace();
  const commit = useStore((s) => s.commit);
  const select = useStore((s) => s.select);
  const from = compiled.index.byId.get(conn.from);
  const to = compiled.index.byId.get(conn.to);
  const joint = compiled.joints.get(conn.id);
  const options = from && to ? compatibleProtocols(from.kind, to.kind) : [];
  const set = (patch: Partial<Connection>, key?: string) => commit((d) => updateConnection(d, conn.id, patch), key ? { coalesce: `${conn.id}:${key}` } : undefined);

  return (
    <div className="insp">
      <div className="insp-kicker">Joint</div>
      <div className="joint-ends">
        {from && (
          <button type="button" className="joint-end" onClick={() => select({ type: 'component', id: from.id })}>
            <BrickIcon kind={from.kind} size={34} />
            <span>{from.name}</span>
            <em>consumer</em>
          </button>
        )}
        <span className="joint-arrow">→</span>
        {to && (
          <button type="button" className="joint-end" onClick={() => select({ type: 'component', id: to.id })}>
            <BrickIcon kind={to.kind} size={34} />
            <span>{to.name}</span>
            <em>provider</em>
          </button>
        )}
      </div>
      <div className={`joint-status ${joint?.status === 'weak' ? 'is-weak' : 'is-strong'}`}>
        {joint?.status === 'weak' ? (
          <>
            <IconXCircle size={16} /> Weak joint — {joint.reason}
          </>
        ) : (
          <>✓ Grips: {to?.name} exposes {PROTOCOL_INFO[conn.protocol].label} and {from?.name} speaks it.</>
        )}
      </div>
      <Field label="Protocol" hint={options.length ? `Compatible: ${options.map((p) => PROTOCOL_INFO[p].label).join(', ')}` : 'These two pieces share no interface.'}>
        <select className="select" value={conn.protocol} onChange={(e) => set({ protocol: e.target.value as Protocol })}>
          {PROTOCOLS.map((p) => (
            <option key={p} value={p}>
              {options.includes(p) ? '✓ ' : '   '}
              {PROTOCOL_INFO[p].label} — {PROTOCOL_INFO[p].description}
            </option>
          ))}
        </select>
      </Field>
      <Field label="What flows across it">
        <input className="input" value={conn.label} onChange={(e) => set({ label: e.target.value }, 'label')} placeholder="e.g. publishes order.placed" />
      </Field>
      <div className="insp-row">
        <button
          type="button"
          className="btn btn-sm btn-soft"
          onClick={() => {
            commit((d) => updateConnection(d, conn.id, { from: conn.to, to: conn.from }));
          }}
        >
          Reverse direction
        </button>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={() => {
            commit((d) => removeConnections(d, [conn.id]));
            select(null);
          }}
        >
          <IconTrash size={14} /> Remove joint
        </button>
      </div>
    </div>
  );
}

function DomainPanel({ d }: { d: Domain }) {
  const { design, compiled } = useWorkspace();
  const commit = useStore((s) => s.commit);
  const select = useStore((s) => s.select);
  const members = design.components.filter((c) => c.domainId === d.id);
  const sb = compiled.subBuilds.find((s) => s.domainId === d.id);
  const others = design.domains.filter((x) => x.id !== d.id);
  const set = (patch: Partial<Domain>, key?: string) => commit((x) => updateDomain(x, d.id, patch), key ? { coalesce: `${d.id}:${key}` } : undefined);
  return (
    <div className="insp">
      <div className="insp-kicker" style={{ color: d.color }}>
        Sub-build {sb ? sb.index + 1 : ''}
      </div>
      <input className="insp-title" value={d.name} onChange={(e) => set({ name: e.target.value }, 'name')} aria-label="Sub-build name" />
      <Field label="Colour">
        <div className="swatches">
          {DOMAIN_COLORS.map((c) => (
            <button key={c} type="button" className={`swatch${c === d.color ? ' is-on' : ''}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={c} />
          ))}
        </div>
      </Field>
      <Field label="Purpose">
        <textarea className="input" rows={3} value={d.description} onChange={(e) => set({ description: e.target.value }, 'desc')} />
      </Field>
      <div className="insp-section">
        <div className="insp-section-title">
          {pluralize(members.length, 'component')}
          {sb ? ` · steps ${sb.firstStep + 1}–${sb.lastStep + 1}` : ''}
        </div>
        <ul className="member-list">
          {members.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => select({ type: 'component', id: c.id })}>
                <BrickIcon kind={c.kind} size={22} />
                <span>{c.name}</span>
                <em>{c.tech}</em>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        className="btn btn-danger btn-sm"
        onClick={() => {
          if (members.length && !confirm(`Remove ${d.name}? Its ${members.length} components move to ${others[0]?.name ?? 'nowhere and are deleted'}.`)) return;
          commit((x) => removeDomain(x, d.id, others[0]?.id));
          select(null);
        }}
      >
        <IconTrash size={14} /> Remove sub-build
      </button>
    </div>
  );
}
