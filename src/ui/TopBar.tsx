import { useEffect, useState } from 'react';
import { downloadFile, pluralize, slugify } from '../model/util';
import { manualMarkdown, mermaidDiagram, partsCsv } from '../engine/exporters';
import { activeBuild, useStore } from '../store/store';
import { Menu, useWorkspace } from './common';
import { IconAlert, IconCheckCircle, IconDownload, IconHistory, IconRedo, IconSave, IconUndo, IconXCircle } from './icons';

function BrandMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path d="M3 9.5 12 5l9 4.5v8L12 22l-9-4.5z" fill="#d97757" />
      <path d="M3 9.5 12 14l9-4.5" fill="none" stroke="#fff" strokeWidth="1.2" opacity=".8" />
      <path d="M12 14v8" stroke="#fff" strokeWidth="1.2" opacity=".6" />
      <ellipse cx="8.5" cy="8.6" rx="1.6" ry=".8" fill="#fff" opacity=".85" />
      <ellipse cx="15.5" cy="8.6" rx="1.6" ry=".8" fill="#fff" opacity=".85" />
      <ellipse cx="12" cy="6.9" rx="1.6" ry=".8" fill="#fff" opacity=".85" />
    </svg>
  );
}

export function TopBar() {
  const { design, compiled } = useWorkspace();
  const build = useStore(activeBuild);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const renameBuild = useStore((s) => s.renameBuild);
  const saveVersion = useStore((s) => s.saveVersion);
  const restoreVersion = useStore((s) => s.restoreVersion);
  const setTab = useStore((s) => s.setTab);
  const setPrinting = useStore((s) => s.setPrinting);
  const [name, setName] = useState(design.name);
  useEffect(() => setName(design.name), [design.name, design.id]);

  const { stats } = compiled;
  const file = slugify(design.name);
  const empty = !design.components.length;

  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        <span className="brand-name">Arch Builder</span>
      </div>
      <input
        className="build-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => (name.trim() ? renameBuild(name) : setName(design.name))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label="Build name"
        size={Math.max(8, name.length)}
      />
      {!empty && (
        <div className="topbar-chips">
          <span className="chip">{pluralize(stats.components, 'component')}</span>
          <span className="chip">{pluralize(stats.steps, 'step')}</span>
          <span className="chip">{pluralize(stats.subBuilds, 'sub-build')}</span>
          <span className="chip">
            {design.grid.w}×{design.grid.h} plate
          </span>
        </div>
      )}
      <span className="toolbar-spacer" />
      {!empty && (
        <button
          type="button"
          className={`status-pill ${stats.errors ? 'is-bad' : stats.warnings ? 'is-warn' : 'is-ok'}`}
          onClick={() => setTab('checks')}
          title="Open the engine checks"
        >
          {stats.errors ? <IconXCircle size={14} /> : stats.warnings ? <IconAlert size={14} /> : <IconCheckCircle size={14} />}
          {stats.errors
            ? `${pluralize(stats.errors, 'error')} · ${stats.weakJoints} weak`
            : stats.warnings
              ? pluralize(stats.warnings, 'warning')
              : 'Holds together'}
        </button>
      )}
      <div className="topbar-actions">
        <button type="button" className="icon-btn" onClick={undo} disabled={!past} title="Undo (⌘Z)">
          <IconUndo size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={redo} disabled={!future} title="Redo (⇧⌘Z)">
          <IconRedo size={16} />
        </button>
        <Menu label={`Versions${build?.versions.length ? ` ${build.versions.length}` : ''}`} icon={<IconHistory size={14} />}>
          {(close) => (
            <div className="menu-list">
              {!build?.versions.length && <div className="menu-empty">No saved versions yet.</div>}
              {[...(build?.versions ?? [])].reverse().map((v, i) => (
                <button
                  key={v.id}
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    restoreVersion(v.id);
                    close();
                  }}
                >
                  <span className="menu-item-main">
                    {v.label}
                    {i === 0 ? ' · latest' : ''}
                  </span>
                  <span className="menu-item-sub">
                    {new Date(v.createdAt).toLocaleString()} · {v.source} · {pluralize(v.design.components.length, 'component')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Menu>
        <button type="button" className="btn btn-ghost" onClick={() => saveVersion()} disabled={empty} title="Save a version">
          <IconSave size={14} /> Save
        </button>
        <Menu label="Download" icon={<IconDownload size={14} />} className="menu-primary">
          {(close) => (
            <div className="menu-list">
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  downloadFile(`${file}.json`, JSON.stringify(design, null, 2), 'application/json');
                  close();
                }}
              >
                <span className="menu-item-main">Design (JSON)</span>
                <span className="menu-item-sub">Re-import it from the Library</span>
              </button>
              <button
                type="button"
                className="menu-item"
                disabled={empty}
                onClick={() => {
                  setPrinting(true);
                  close();
                }}
              >
                <span className="menu-item-main">Manual (PDF)</span>
                <span className="menu-item-sub">{pluralize(stats.pages, 'page')}, via the print dialog</span>
              </button>
              <button
                type="button"
                className="menu-item"
                disabled={empty}
                onClick={() => {
                  downloadFile(`${file}-manual.md`, manualMarkdown(design, compiled), 'text/markdown');
                  close();
                }}
              >
                <span className="menu-item-main">Runbook (Markdown)</span>
                <span className="menu-item-sub">Every step, check and sign-off</span>
              </button>
              <button
                type="button"
                className="menu-item"
                disabled={empty}
                onClick={() => {
                  downloadFile(`${file}-components.csv`, partsCsv(design, compiled), 'text/csv');
                  close();
                }}
              >
                <span className="menu-item-main">Component register (CSV)</span>
                <span className="menu-item-sub">For the CMDB or a spreadsheet</span>
              </button>
              <button
                type="button"
                className="menu-item"
                disabled={empty}
                onClick={() => {
                  downloadFile(`${file}.mmd`, mermaidDiagram(design), 'text/plain');
                  close();
                }}
              >
                <span className="menu-item-main">Diagram (Mermaid)</span>
                <span className="menu-item-sub">Paste into docs and wikis</span>
              </button>
            </div>
          )}
        </Menu>
      </div>
    </header>
  );
}
