import { useMemo, useState } from 'react';
import { CATEGORY_INFO, KIND_INFO, PROTOCOL_INFO } from '../../model/catalog';
import type { ArchComponent } from '../../model/types';
import { downloadFile, formatMoney, formatNumber, slugify } from '../../model/util';
import { partsCsv } from '../../engine/exporters';
import { BrickIcon } from '../../iso/BrickIcon';
import { useStore } from '../../store/store';
import { Segmented, Stat, useWorkspace } from '../common';
import { IconAlert, IconDownload, IconSearch } from '../icons';

type SortKey = 'name' | 'kind' | 'tech' | 'domain' | 'owner' | 'criticality' | 'lifecycle' | 'replicas' | 'joints';

export function PartsView() {
  const { design, compiled } = useWorkspace();
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const [mode, setMode] = useState<'bom' | 'register'>('bom');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'domain', dir: 1 });
  const domainName = (id: string) => design.domains.find((d) => d.id === id)?.name ?? id;
  const domainColor = (id: string) => design.domains.find((d) => d.id === id)?.color ?? '#999';
  const q = query.trim().toLowerCase();

  const lines = compiled.parts.filter(
    (l) => !q || l.tech.toLowerCase().includes(q) || KIND_INFO[l.kind].label.toLowerCase().includes(q) || l.componentIds.some((id) => compiled.index.byId.get(id)!.name.toLowerCase().includes(q)),
  );

  const rows = useMemo(() => {
    const joints = (c: ArchComponent) => (compiled.index.incoming.get(c.id)?.length ?? 0) + (compiled.index.outgoing.get(c.id)?.length ?? 0);
    const value = (c: ArchComponent): string | number => {
      switch (sort.key) {
        case 'name':
          return c.name;
        case 'kind':
          return KIND_INFO[c.kind].label;
        case 'tech':
          return c.tech;
        case 'domain':
          return domainName(c.domainId);
        case 'owner':
          return c.owner;
        case 'criticality':
          return c.criticality;
        case 'lifecycle':
          return c.lifecycle;
        case 'replicas':
          return c.replicas;
        case 'joints':
          return joints(c);
      }
    };
    return design.components
      .filter((c) => !q || [c.name, c.tech, c.owner, KIND_INFO[c.kind].label, domainName(c.domainId)].some((v) => v.toLowerCase().includes(q)))
      .sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
        return cmp * sort.dir || a.name.localeCompare(b.name);
      })
      .map((c) => ({ c, joints: joints(c) }));
  }, [design, compiled, q, sort]);

  const header = (key: SortKey, label: string, cls = '') => (
    <th className={cls}>
      <button type="button" className="th-sort" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );

  if (!design.components.length) return <div className="view view-parts is-empty">No parts yet.</div>;

  return (
    <div className="view view-parts">
      <div className="toolbar">
        <Segmented
          size="sm"
          label="Parts view"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'bom', label: 'Bill of materials' },
            { value: 'register', label: 'Component register' },
          ]}
        />
        <label className="search">
          <IconSearch size={14} />
          <input placeholder="Filter by name, tech, owner…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <span className="toolbar-spacer" />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => downloadFile(`${slugify(design.name)}-components.csv`, partsCsv(design, compiled), 'text/csv')}
        >
          <IconDownload size={14} /> CSV
        </button>
      </div>

      <div className="scroll-body">
        <div className="stat-row">
          <Stat value={formatNumber(compiled.stats.components)} label="Components" />
          <Stat value={formatNumber(compiled.stats.instances)} label="Instances" />
          <Stat value={formatNumber(compiled.parts.length)} label="Distinct parts" />
          <Stat value={formatNumber(new Set(design.components.map((c) => c.owner)).size)} label="Owning teams" />
          <Stat value={formatMoney(compiled.stats.monthlyCost)} label="Est. run cost / month" />
        </div>

        {mode === 'bom' ? (
          <table className="table">
            <thead>
              <tr>
                <th>Part</th>
                <th>Technology</th>
                <th className="num">Components</th>
                <th className="num">Instances</th>
                <th>Sub-builds</th>
                <th>Studs (provides)</th>
                <th className="num">Est. / month</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const newCat = i === 0 || lines[i - 1].category !== l.category;
                return [
                  newCat && (
                    <tr key={`cat-${l.category}`} className="row-group">
                      <td colSpan={7} style={{ color: CATEGORY_INFO[l.category].color }}>
                        {CATEGORY_INFO[l.category].label}
                        <span className="row-group-sub">{CATEGORY_INFO[l.category].description}</span>
                      </td>
                    </tr>
                  ),
                  <tr key={l.key}>
                    <td>
                      <div className="cell-part">
                        <BrickIcon kind={l.kind} replicas={Math.min(4, l.instances)} size={30} />
                        <span>{KIND_INFO[l.kind].label}</span>
                      </div>
                    </td>
                    <td className="strong">{l.tech}</td>
                    <td className="num">
                      <span className="link-list">
                        {l.componentIds.map((id) => (
                          <button key={id} type="button" className="link" onClick={() => select({ type: 'component', id })} title={compiled.index.byId.get(id)!.name}>
                            {compiled.index.byId.get(id)!.name}
                          </button>
                        ))}
                      </span>
                    </td>
                    <td className="num strong">×{l.instances}</td>
                    <td>
                      {l.domainIds.map((d) => (
                        <span key={d} className="chip" style={{ borderColor: domainColor(d), color: domainColor(d) }}>
                          {domainName(d)}
                        </span>
                      ))}
                    </td>
                    <td>
                      {KIND_INFO[l.kind].provides.length ? (
                        KIND_INFO[l.kind].provides.map((p) => (
                          <span key={p} className="proto" style={{ ['--proto' as string]: PROTOCOL_INFO[p].color }}>
                            {PROTOCOL_INFO[p].label}
                          </span>
                        ))
                      ) : (
                        <span className="muted">smooth tile</span>
                      )}
                    </td>
                    <td className="num">{formatMoney(l.monthlyCost)}</td>
                  </tr>,
                ];
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total</td>
                <td className="num strong">×{compiled.stats.instances}</td>
                <td colSpan={2} />
                <td className="num strong">{formatMoney(compiled.stats.monthlyCost)}</td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <table className="table table-register">
            <thead>
              <tr>
                {header('name', 'Component')}
                {header('kind', 'Kind')}
                {header('tech', 'Technology')}
                {header('domain', 'Sub-build')}
                {header('owner', 'Owner')}
                {header('criticality', 'Tier')}
                {header('lifecycle', 'Lifecycle')}
                {header('replicas', 'Replicas', 'num')}
                {header('joints', 'Joints', 'num')}
                <th>Checks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, joints }) => {
                const issues = compiled.issuesByComponent.get(c.id) ?? [];
                const errors = issues.filter((i) => i.severity === 'error').length;
                const warnings = issues.filter((i) => i.severity === 'warning').length;
                return (
                  <tr
                    key={c.id}
                    className={`row-click${selection?.type === 'component' && selection.id === c.id ? ' is-selected' : ''}`}
                    onClick={() => select({ type: 'component', id: c.id })}
                  >
                    <td>
                      <div className="cell-part">
                        <BrickIcon kind={c.kind} replicas={c.replicas} size={24} />
                        <span className="strong">{c.name}</span>
                      </div>
                    </td>
                    <td>{KIND_INFO[c.kind].label}</td>
                    <td>{c.tech}</td>
                    <td>
                      <span className="chip" style={{ borderColor: domainColor(c.domainId), color: domainColor(c.domainId) }}>
                        {domainName(c.domainId)}
                      </span>
                    </td>
                    <td>{c.owner || <span className="muted">—</span>}</td>
                    <td>
                      <span className={`tier tier-${c.criticality}`}>{c.criticality}</span>
                    </td>
                    <td>
                      <span className={`life life-${c.lifecycle}`}>{c.lifecycle}</span>
                    </td>
                    <td className="num">{c.replicas}</td>
                    <td className="num">{joints}</td>
                    <td>
                      {errors + warnings === 0 ? (
                        <span className="ok-dot">✓</span>
                      ) : (
                        <span className={`issue-count ${errors ? 'sev-error' : 'sev-warning'}`}>
                          <IconAlert size={12} /> {errors + warnings}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
