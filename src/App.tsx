import { Suspense, lazy, useEffect, useMemo } from 'react';
import { compile } from './engine/compile';
import { emptyDesign, removeComponents, removeConnections } from './engine/ops';
import { activeBuild, useStore, type Tab } from './store/store';
import { WorkspaceContext } from './ui/common';
import { IconBook, IconBox, IconCheckCircle, IconLayout, IconList } from './ui/icons';
import { Inspector } from './ui/Inspector';
import { LeftPanel } from './ui/panels/LeftPanel';
import { Showcase, Toasts } from './ui/Showcase';
import { TopBar } from './ui/TopBar';
import { ChecksView } from './ui/views/ChecksView';
import { ManualView, PrintManual } from './ui/views/ManualView';
import { ModelView } from './ui/views/ModelView';
import { PartsView } from './ui/views/PartsView';

const TABS: { id: Tab; label: string; icon: typeof IconBox }[] = [
  { id: 'model', label: 'Model', icon: IconBox },
  { id: 'design', label: 'Design', icon: IconLayout },
  { id: 'manual', label: 'Manual', icon: IconBook },
  { id: 'parts', label: 'Parts', icon: IconList },
  { id: 'checks', label: 'Checks', icon: IconCheckCircle },
];

const FALLBACK = emptyDesign('New build');

// The diagram editor pulls in React Flow; load it on first use.
const DesignView = lazy(() => import('./ui/views/DesignView').then((m) => ({ default: m.DesignView })));

export function App() {
  const build = useStore(activeBuild);
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const showcase = useStore((s) => s.showcase);
  const printing = useStore((s) => s.printing);
  const busy = useStore((s) => s.busy);

  useEffect(() => {
    useStore.getState().init();
  }, []);

  // Global shortcuts: undo/redo, delete the selection, escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = !!target.closest('input, textarea, select, [contenteditable="true"]');
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        s.redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && s.selection) {
        const sel = s.selection;
        if (sel.type === 'component') s.commit((d) => removeComponents(d, [sel.id]));
        else if (sel.type === 'connection') s.commit((d) => removeConnections(d, [sel.id]));
        else return;
        e.preventDefault();
        s.select(null);
      } else if (e.key === 'Escape' && !typing) {
        s.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const design = build?.design ?? FALLBACK;
  const compiled = useMemo(() => compile(design), [design]);
  const workspace = useMemo(() => ({ design, compiled }), [design, compiled]);

  if (!build) return <div className="boot">Loading…</div>;

  return (
    <WorkspaceContext.Provider value={workspace}>
      <div className={`app${printing ? ' is-printing' : ''}`}>
        <TopBar />
        <div className="workspace">
          <LeftPanel />
          <main className="stage">
            <nav className="stage-tabs" aria-label="Views">
              {TABS.map((t) => (
                <button key={t.id} type="button" className={`stage-tab${tab === t.id ? ' is-on' : ''}`} onClick={() => setTab(t.id)}>
                  <t.icon size={14} />
                  {t.label}
                  {t.id === 'checks' && compiled.stats.errors + compiled.stats.warnings > 0 && (
                    <span className={`tab-badge ${compiled.stats.errors ? 'is-bad' : 'is-warn'}`}>{compiled.stats.errors + compiled.stats.warnings}</span>
                  )}
                </button>
              ))}
              {busy && <span className="stage-busy">Designing…</span>}
            </nav>
            <div className="stage-body">
              {tab === 'model' && <ModelView />}
              {tab === 'design' && (
                <Suspense fallback={<div className="view is-empty">Loading the editor…</div>}>
                  <DesignView />
                </Suspense>
              )}
              {tab === 'manual' && <ManualView />}
              {tab === 'parts' && <PartsView />}
              {tab === 'checks' && <ChecksView />}
            </div>
          </main>
          <Inspector />
        </div>
        <Toasts />
        {showcase && design.components.length > 0 && <Showcase />}
      </div>
      {printing && design.components.length > 0 && <PrintManual />}
    </WorkspaceContext.Provider>
  );
}
