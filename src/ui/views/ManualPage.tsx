import { memo, useMemo, type ReactNode } from 'react';
import { KIND_INFO } from '../../model/catalog';
import type { Design } from '../../model/types';
import { formatMoney, formatNumber, pluralize } from '../../model/util';
import type { CompileResult, ManualPage as Page } from '../../engine/types';
import { IsoScene } from '../../iso/IsoScene';
import { VIEWS } from '../../iso/camera';
import { BrickIcon } from '../../iso/BrickIcon';

interface Props {
  page: Page;
  index: number;
  design: Design;
  compiled: CompileResult;
  mode: 'screen' | 'print' | 'thumb';
}

function installedUpTo(compiled: CompileResult, stepIndex: number): Set<string> {
  const set = new Set<string>();
  for (const [id, at] of compiled.installedAt) if (at <= stepIndex) set.add(id);
  return set;
}

function ManualPageImpl({ page, index, design, compiled, mode }: Props) {
  const total = compiled.pages.length;
  const thumb = mode === 'thumb';
  const scene = { plateStuds: !thumb, zoneLabels: !thumb } as const;

  const footer = (section: string) =>
    thumb ? null : (
      <footer className="page-footer">
        <span>
          {design.name}
          {section ? ` · ${section}` : ''}
        </span>
        <span>
          {index + 1} / {total}
        </span>
      </footer>
    );

  if (page.kind === 'cover') {
    return (
      <article className="page page-cover">
        <div className="cover-text">
          <div className="cover-kicker">Build manual</div>
          <h1>{design.name}</h1>
          {!thumb && <p className="cover-summary">{design.summary}</p>}
          {!thumb && (
            <div className="cover-stats">
              <CoverStat value={compiled.stats.components} label="Components" />
              <CoverStat value={compiled.stats.instances} label="Instances" />
              <CoverStat value={compiled.stats.subBuilds} label="Sub-builds" />
              <CoverStat value={compiled.stats.steps} label="Steps" />
              <CoverStat value={compiled.stats.joints} label="Joints" />
              <CoverStat value={total} label="Pages" />
            </div>
          )}
        </div>
        <div className="cover-model">
          <IsoScene design={design} camera={VIEWS.iso} joints={compiled.joints} links={thumb ? 'none' : 'business'} labels="none" {...scene} />
        </div>
        {footer('')}
      </article>
    );
  }

  if (page.kind === 'inventory') {
    return (
      <article className="page page-inventory">
        <header className="page-head">
          <h2>Parts inventory</h2>
          {page.parts > 1 && (
            <span className="page-head-sub">
              {page.part} of {page.parts}
            </span>
          )}
        </header>
        <div className="inventory-grid">
          {page.lines.map((line) => (
            <div key={line.key} className="inventory-card">
              <BrickIcon kind={line.kind} replicas={Math.min(4, line.instances)} size={thumb ? 22 : 52} />
              {!thumb && (
                <div className="inventory-text">
                  <div className="inventory-count">×{line.instances}</div>
                  <div className="inventory-tech">{line.tech}</div>
                  <div className="inventory-kind">
                    {KIND_INFO[line.kind].label} · {pluralize(line.componentIds.length, 'component')}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {footer('Parts')}
      </article>
    );
  }

  if (page.kind === 'subbuild') {
    const sb = compiled.subBuilds[page.subBuildIndex];
    const visible = installedUpTo(compiled, sb.lastStep);
    return (
      <article className="page page-subbuild" style={{ ['--sb' as string]: sb.color }}>
        <div className="subbuild-text">
          <div className="subbuild-kicker">Sub-build {sb.index + 1}</div>
          <h2 style={{ color: sb.color }}>{sb.name}</h2>
          {!thumb && sb.description && <p>{sb.description}</p>}
          {!thumb && (
            <>
              <div className="subbuild-range">
                Steps {sb.firstStep + 1}–{sb.lastStep + 1} · {pluralize(sb.componentIds.length, 'component')}
              </div>
              <ul className="subbuild-parts">
                {sb.componentIds.map((id) => {
                  const c = compiled.index.byId.get(id)!;
                  return (
                    <li key={id}>
                      <BrickIcon kind={c.kind} size={24} />
                      <span>{c.name}</span>
                      <em>{c.tech}</em>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        <div className="subbuild-model">
          <IsoScene design={design} camera={VIEWS.iso} visible={visible} focusDomain={sb.domainId} links="none" labels="none" {...scene} />
        </div>
        {footer(sb.name)}
      </article>
    );
  }

  if (page.kind === 'step') {
    return <StepPage stepIndex={page.stepIndex} design={design} compiled={compiled} thumb={thumb} footer={footer} />;
  }

  // final
  const { stats } = compiled;
  return (
    <article className="page page-final">
      <header className="page-head">
        <h2>Finished model</h2>
      </header>
      <div className="final-body">
        <div className="final-model">
          <IsoScene design={design} camera={VIEWS.iso} joints={compiled.joints} links={thumb ? 'none' : 'business'} labels="none" {...scene} />
        </div>
        {!thumb && (
          <div className="final-side">
            <div className="final-verdict">
              <div className={`verdict ${stats.errors ? 'is-bad' : 'is-ok'}`}>
                {stats.errors ? `${pluralize(stats.errors, 'error')} to resolve` : 'Holds together'}
              </div>
              <div className="final-lines">
                <div>
                  {formatNumber(stats.joints)} joints · {stats.weakJoints} weak
                </div>
                <div>{pluralize(stats.warnings, 'warning')}</div>
                <div>Est. run cost {formatMoney(stats.monthlyCost)}/month</div>
                <div>Compiled in {compiled.ms.toFixed(1)} ms</div>
              </div>
            </div>
            <table className="signoff">
              <thead>
                <tr>
                  <th>Sign-off</th>
                  <th>Name</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {['Architecture review board', 'Security', 'Operations / SRE', 'Product owner'].map((r) => (
                  <tr key={r}>
                    <td>{r}</td>
                    <td />
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {footer('Finished model')}
    </article>
  );
}

function CoverStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="cover-stat">
      <div className="cover-stat-value">{formatNumber(value)}</div>
      <div className="cover-stat-label">{label}</div>
    </div>
  );
}

function StepPage({
  stepIndex,
  design,
  compiled,
  thumb,
  footer,
}: {
  stepIndex: number;
  design: Design;
  compiled: CompileResult;
  thumb: boolean;
  footer: (section: string) => ReactNode;
}) {
  const step = compiled.steps[stepIndex];
  const sb = compiled.subBuilds[step.subBuildIndex];
  const visible = useMemo(() => installedUpTo(compiled, stepIndex), [compiled, stepIndex]);
  const highlight = useMemo(() => new Set(step.adds), [step]);
  const highlightLinks = useMemo(() => new Set(step.wires), [step]);
  const verify = step.type === 'verify';

  return (
    <article className={`page page-step${verify ? ' is-verify' : ''}`} style={{ ['--sb' as string]: sb.color }}>
      <div className="step-left">
        <div className="step-tag">
          <span className="step-tag-dot" style={{ background: sb.color }} />
          {sb.name}
        </div>
        <div className="step-number">{step.number}</div>
        {!thumb && step.adds.length > 0 && (
          <div className="parts-callout">
            {step.adds.map((id) => {
              const c = compiled.index.byId.get(id)!;
              return (
                <div key={id} className="parts-callout-item">
                  <BrickIcon kind={c.kind} replicas={c.replicas} size={56} />
                  <div className="parts-callout-count">{c.replicas}×</div>
                  <div className="parts-callout-name">{c.name}</div>
                </div>
              );
            })}
          </div>
        )}
        {!thumb && verify && <div className="verify-badge">Checkpoint</div>}
      </div>

      <div className="step-model">
        <IsoScene
          design={design}
          camera={VIEWS.iso}
          joints={compiled.joints}
          visible={visible}
          highlight={highlight}
          highlightLinks={highlightLinks}
          focusDomain={verify ? sb.domainId : null}
          links={thumb ? 'none' : 'business'}
          labels={thumb ? 'none' : 'auto'}
          plateStuds={!thumb}
          zoneLabels={!thumb}
          fit="content"
        />
      </div>

      {!thumb && (
        <div className="step-right">
          <h3>{step.title}</h3>
          <ol className="step-instructions">
            {step.instructions.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
          {step.checks.length > 0 && (
            <ul className="step-checks">
              {step.checks.map((line, i) => (
                <li key={i} className={line.startsWith('⚠') ? 'is-weak' : ''}>
                  <span className="checkbox" />
                  {line.replace(/^⚠\s*/, '')}
                </li>
              ))}
            </ul>
          )}
          <div className="step-inset">
            <IsoScene design={design} camera={VIEWS.iso} focusDomain={sb.domainId} links="none" labels="none" plateStuds={false} zoneLabels={false} />
          </div>
        </div>
      )}
      {footer(sb.name)}
    </article>
  );
}

export const ManualPageView = memo(ManualPageImpl);
