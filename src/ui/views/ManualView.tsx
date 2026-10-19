import { useEffect, useRef } from 'react';
import { useStore } from '../../store/store';
import { LazyMount, useWorkspace } from '../common';
import { IconChevronLeft, IconChevronRight, IconPrinter } from '../icons';
import { ManualPageView } from './ManualPage';
import type { ManualPage } from '../../engine/types';

function pageTitle(p: ManualPage, subNames: string[], stepNumber: (i: number) => number): string {
  switch (p.kind) {
    case 'cover':
      return 'Cover';
    case 'inventory':
      return `Parts${p.parts > 1 ? ` ${p.part}/${p.parts}` : ''}`;
    case 'subbuild':
      return subNames[p.subBuildIndex];
    case 'step':
      return `Step ${stepNumber(p.stepIndex)}`;
    case 'final':
      return 'Finished';
  }
}

export function ManualView() {
  const { design, compiled } = useWorkspace();
  const page = useStore((s) => s.manualPage);
  const setPage = useStore((s) => s.setManualPage);
  const setPrinting = useStore((s) => s.setPrinting);
  const total = compiled.pages.length;
  const current = Math.min(page, total - 1);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setPage(Math.min(total - 1, current + 1));
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setPage(Math.max(0, current - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, total, setPage]);

  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-page="${current}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [current]);

  if (!design.components.length) {
    return <div className="view view-manual is-empty">The manual appears once there is something to build.</div>;
  }

  const p = compiled.pages[current];
  const subNames = compiled.subBuilds.map((s) => s.name);
  const stepNumber = (i: number) => compiled.steps[i].number;
  const currentSub =
    p.kind === 'subbuild' ? p.subBuildIndex : p.kind === 'step' ? compiled.steps[p.stepIndex].subBuildIndex : -1;

  return (
    <div className="view view-manual">
      <div className="toolbar">
        <button type="button" className="icon-btn" disabled={current === 0} onClick={() => setPage(current - 1)} title="Previous page">
          <IconChevronLeft size={16} />
        </button>
        <select className="select select-sm" value={current} onChange={(e) => setPage(Number(e.target.value))} aria-label="Page">
          {compiled.pages.map((pg, i) => (
            <option key={i} value={i}>
              Page {i + 1} of {total} — {pageTitle(pg, subNames, stepNumber)}
            </option>
          ))}
        </select>
        <button type="button" className="icon-btn" disabled={current === total - 1} onClick={() => setPage(current + 1)} title="Next page">
          <IconChevronRight size={16} />
        </button>
        <span className="toolbar-sep" />
        <select
          className="select select-sm"
          value={currentSub}
          aria-label="Sub-build"
          onChange={(e) => {
            const idx = Number(e.target.value);
            const at = compiled.pages.findIndex((pg) => pg.kind === 'subbuild' && pg.subBuildIndex === idx);
            if (at >= 0) setPage(at);
          }}
        >
          <option value={-1}>Sub-build…</option>
          {compiled.subBuilds.map((s) => (
            <option key={s.domainId} value={s.index}>
              {s.index + 1}. {s.name}
            </option>
          ))}
        </select>
        <span className="toolbar-spacer" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPrinting(true)} title="Print or save every page as PDF">
          <IconPrinter size={14} /> Manual PDF
        </button>
      </div>

      <div className="manual-stage">
        <div className="sheet">
          <ManualPageView page={p} index={current} design={design} compiled={compiled} mode="screen" />
        </div>
      </div>

      <div className="filmstrip" ref={stripRef}>
        {compiled.pages.map((pg, i) => (
          <button
            key={i}
            type="button"
            data-page={i}
            className={`film${i === current ? ' is-on' : ''}`}
            onClick={() => setPage(i)}
            title={pageTitle(pg, subNames, stepNumber)}
          >
            <LazyMount className="film-thumb" placeholder={<div className="film-ph" />}>
              <ManualPageView page={pg} index={i} design={design} compiled={compiled} mode="thumb" />
            </LazyMount>
            <span className="film-num">{i + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function PrintManual() {
  const { design, compiled } = useWorkspace();
  const setPrinting = useStore((s) => s.setPrinting);
  useEffect(() => {
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    const id = setTimeout(() => window.print(), 400);
    return () => {
      clearTimeout(id);
      window.removeEventListener('afterprint', done);
    };
  }, [setPrinting]);
  return (
    <div className="print-root">
      {compiled.pages.map((p, i) => (
        <div key={i} className="print-sheet">
          <ManualPageView page={p} index={i} design={design} compiled={compiled} mode="print" />
        </div>
      ))}
    </div>
  );
}
