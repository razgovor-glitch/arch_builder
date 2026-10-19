import { useState } from 'react';
import { PROTOCOL_INFO } from '../../model/catalog';
import { formatNumber } from '../../model/util';
import { applyFix } from '../../engine/ops';
import type { Issue, Severity } from '../../engine/types';
import { useStore } from '../../store/store';
import { Segmented, Stat, useWorkspace } from '../common';
import { IconAlert, IconCheckCircle, IconInfo, IconWand, IconXCircle } from '../icons';

const SEVERITY_ICON: Record<Severity, typeof IconAlert> = { error: IconXCircle, warning: IconAlert, info: IconInfo };

export function ChecksView() {
  const { design, compiled } = useWorkspace();
  const select = useStore((s) => s.select);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const [mode, setMode] = useState<'issues' | 'joints'>('issues');
  const [weakOnly, setWeakOnly] = useState(false);
  const { stats } = compiled;

  const fix = (issue: Issue) => {
    if (!issue.fix) return;
    commit((d) => applyFix(d, issue.fix!.actions));
    toast(`Fixed: ${issue.title}`, 'success');
  };
  const fixable = compiled.issues.filter((i) => i.fix && i.severity !== 'info');
  const fixAll = () => {
    commit((d) => fixable.reduce((acc, i) => applyFix(acc, i.fix!.actions), d));
    toast(`Applied ${fixable.length} fixes`, 'success');
  };

  const name = (id: string) => compiled.index.byId.get(id)?.name ?? id;
  const ok = stats.errors === 0;

  return (
    <div className="view view-checks">
      <div className="toolbar">
        <Segmented
          size="sm"
          label="Checks view"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'issues', label: `Findings (${stats.errors + stats.warnings + stats.infos})` },
            { value: 'joints', label: `Joints (${stats.joints})` },
          ]}
        />
        <span className="toolbar-spacer" />
        {fixable.length > 1 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={fixAll}>
            <IconWand size={14} /> Fix all {fixable.length}
          </button>
        )}
      </div>
      <div className="scroll-body">
        <div className={`verdict-banner ${ok ? (stats.warnings ? 'is-warn' : 'is-ok') : 'is-bad'}`}>
          {ok ? <IconCheckCircle size={22} /> : <IconXCircle size={22} />}
          <div>
            <div className="verdict-title">
              {ok ? (stats.warnings ? 'Holds together, with warnings' : 'Holds together') : 'Does not hold together yet'}
            </div>
            <div className="verdict-sub">
              Every joint checked: a joint grips only when the consumer speaks a protocol the provider exposes. Compiled in {compiled.ms.toFixed(1)} ms.
            </div>
          </div>
        </div>
        <div className="stat-row">
          <Stat value={formatNumber(stats.joints)} label="Joints" />
          <Stat value={formatNumber(stats.weakJoints)} label="Weak joints" tone={stats.weakJoints ? 'bad' : 'ok'} />
          <Stat value={formatNumber(stats.errors)} label="Errors" tone={stats.errors ? 'bad' : 'ok'} />
          <Stat value={formatNumber(stats.warnings)} label="Warnings" tone={stats.warnings ? 'warn' : 'ok'} />
          <Stat value={formatNumber(stats.infos)} label="Notes" />
        </div>

        {mode === 'issues' ? (
          compiled.issues.length === 0 ? (
            <div className="all-clear">
              <IconCheckCircle size={40} />
              <div>No findings. Every piece is attached and every joint grips.</div>
            </div>
          ) : (
            <div className="issue-list">
              {compiled.issues.map((issue) => {
                const Icon = SEVERITY_ICON[issue.severity];
                return (
                  <div key={issue.id} className={`issue sev-${issue.severity}`}>
                    <Icon size={18} className="issue-icon" />
                    <div className="issue-body">
                      <div className="issue-title">{issue.title}</div>
                      <div className="issue-msg">{issue.message}</div>
                      <div className="issue-refs">
                        {issue.componentIds.map((id) => (
                          <button key={id} type="button" className="chip chip-btn" onClick={() => select({ type: 'component', id })}>
                            {name(id)}
                          </button>
                        ))}
                        {issue.connectionIds.slice(0, 3).map((id) => {
                          const conn = compiled.index.connById.get(id);
                          if (!conn) return null;
                          return (
                            <button key={id} type="button" className="chip chip-btn" onClick={() => select({ type: 'connection', id })}>
                              {name(conn.from)} → {name(conn.to)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {issue.fix && (
                      <button type="button" className="btn btn-sm btn-soft" onClick={() => fix(issue)}>
                        <IconWand size={13} /> {issue.fix.label}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <>
            <label className="check">
              <input type="checkbox" checked={weakOnly} onChange={(e) => setWeakOnly(e.target.checked)} /> Weak joints only
            </label>
            <table className="table">
              <thead>
                <tr>
                  <th>Consumer</th>
                  <th />
                  <th>Provider</th>
                  <th>Protocol</th>
                  <th>Flow</th>
                  <th>What flows</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {design.connections
                  .filter((c) => !weakOnly || compiled.joints.get(c.id)?.status === 'weak')
                  .map((c) => {
                    const joint = compiled.joints.get(c.id);
                    const weak = joint?.status === 'weak';
                    return (
                      <tr key={c.id} className={`row-click${weak ? ' row-weak' : ''}`} onClick={() => select({ type: 'connection', id: c.id })}>
                        <td className="strong">{name(c.from)}</td>
                        <td className="muted">→</td>
                        <td className="strong">{name(c.to)}</td>
                        <td>
                          <span className="proto" style={{ ['--proto' as string]: PROTOCOL_INFO[c.protocol].color }}>
                            {PROTOCOL_INFO[c.protocol].label}
                          </span>
                        </td>
                        <td className="muted">{PROTOCOL_INFO[c.protocol].sync ? 'sync' : 'async'}</td>
                        <td>{c.label}</td>
                        <td>{weak ? <span className="sev-error-text" title={joint?.reason}>Weak — {joint?.reason}</span> : <span className="ok-dot">✓ grips</span>}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
