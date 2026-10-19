import { useEffect, useState } from 'react';
import { formatNumber } from '../model/util';
import { IsoScene } from '../iso/IsoScene';
import { VIEWS, type Camera } from '../iso/camera';
import { useStore } from '../store/store';
import { useCountUp, useWorkspace } from './common';
import { IconCheck, IconX } from './icons';

function Counter({ value, label, decimals = 0, suffix = '', ok }: { value: number; label: string; decimals?: number; suffix?: string; ok?: boolean }) {
  const v = useCountUp(value, 1400);
  return (
    <div className="show-stat">
      <div className="show-value">
        {decimals ? v.toFixed(decimals) : formatNumber(Math.round(v))}
        {suffix && <small>{suffix}</small>}
        {ok !== undefined && <span className={`show-ok ${ok ? 'is-ok' : 'is-bad'}`}>{ok ? <IconCheck size={18} /> : '!'}</span>}
      </div>
      <div className="show-label">{label}</div>
    </div>
  );
}

/** Full-screen presentation: the finished model turning slowly, with the engine's numbers. */
export function Showcase() {
  const { design, compiled } = useWorkspace();
  const setShowcase = useStore((s) => s.setShowcase);
  const [camera, setCamera] = useState<Camera>(VIEWS.iso);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      setCamera((c) => ({ az: c.az + dt * 0.012, el: 30 }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShowcase(false);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
    };
  }, [setShowcase]);

  const { stats } = compiled;
  return (
    <div className="showcase" role="dialog" aria-label="Showcase">
      <button type="button" className="icon-btn showcase-close" onClick={() => setShowcase(false)} title="Close (Esc)">
        <IconX size={18} />
      </button>
      <div className="showcase-title">{design.name}</div>
      <div className="showcase-model">
        <IsoScene design={design} camera={camera} joints={compiled.joints} links="business" labels="none" fit="stable" zoneLabels={false} />
      </div>
      <div className="showcase-stats">
        <Counter value={stats.components} label="Components" />
        <Counter value={stats.steps} label="Steps" />
        <Counter value={stats.pages} label="Pages" />
        <Counter value={stats.joints} label="Joints" />
        <Counter value={compiled.ms} label="Compile" decimals={1} suffix="ms" />
        <Counter value={stats.errors} label="Errors" ok={stats.errors === 0} />
        <Counter value={stats.warnings} label="Warnings" ok={stats.warnings === 0} />
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast toast-${t.tone}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}
