import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { KIND_INFO, PROTOCOL_INFO } from '../../model/catalog';
import { formatNumber, pluralize } from '../../model/util';
import { IsoScene, type LinkMode } from '../../iso/IsoScene';
import { CELL, VIEWS, easeInOut, lerpCamera, type Camera, type ViewName } from '../../iso/camera';
import { useStore } from '../../store/store';
import { Segmented, useWorkspace } from '../common';
import {
  IconAlert,
  IconCheck,
  IconLink,
  IconMaximize,
  IconPause,
  IconPlay,
  IconRotate,
  IconSkipBack,
  IconSkipForward,
  IconTag,
} from '../icons';

const SPEEDS = [0.5, 1, 2, 4];

export function useCameraTween(initial: Camera) {
  const [camera, setCamera] = useState<Camera>(initial);
  const raf = useRef(0);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const animateTo = useCallback((target: Camera, ms = 550) => {
    cancelAnimationFrame(raf.current);
    const from = cameraRef.current;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      setCamera(lerpCamera(from, target, easeInOut(k)));
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, []);
  const stop = useCallback(() => cancelAnimationFrame(raf.current), []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return { camera, setCamera, animateTo, stop };
}

export function ModelView() {
  const { design, compiled } = useWorkspace();
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const timelineStep = useStore((s) => s.timelineStep);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.speed);
  const setTimeline = useStore((s) => s.setTimeline);
  const setPlaying = useStore((s) => s.setPlaying);
  const setSpeed = useStore((s) => s.setSpeed);
  const setShowcase = useStore((s) => s.setShowcase);

  const { camera, setCamera, animateTo, stop } = useCameraTween(VIEWS.iso);
  const [view, setView] = useState<ViewName | 'free'>('iso');
  const [links, setLinks] = useState<LinkMode>('business');
  const [labels, setLabels] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; cam: Camera; pan: { x: number; y: number }; mode: 'orbit' | 'pan'; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const steps = compiled.steps;
  const step = timelineStep !== null ? steps[timelineStep] : null;

  // Playback
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const s = useStore.getState();
      const current = s.timelineStep ?? -1;
      if (current + 1 >= steps.length) s.setTimeline(null, false);
      else s.setTimeline(current + 1);
    }, 700 / speed);
    return () => clearInterval(id);
  }, [playing, speed, steps.length]);

  // Keep the step in range when the design changes underneath the timeline.
  useEffect(() => {
    if (timelineStep !== null && timelineStep >= steps.length) setTimeline(null, false);
  }, [timelineStep, steps.length, setTimeline]);

  const visible = useMemo(() => {
    if (timelineStep === null) return null;
    return new Set(design.components.filter((c) => (compiled.installedAt.get(c.id) ?? Infinity) <= timelineStep).map((c) => c.id));
  }, [timelineStep, design.components, compiled.installedAt]);
  const highlight = useMemo(() => (step ? new Set(step.adds) : null), [step]);
  const highlightLinks = useMemo(() => (step ? new Set(step.wires) : null), [step]);
  const errorIds = useMemo(
    () => new Set([...compiled.issuesByComponent.entries()].filter(([, list]) => list.some((i) => i.severity === 'error')).map(([id]) => id)),
    [compiled.issuesByComponent],
  );

  // Wheel zoom (non-passive so the page does not scroll).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(5, Math.max(0.5, z * Math.exp(-e.deltaY * 0.0015))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const goView = (name: ViewName) => {
    setView(name);
    animateTo(VIEWS[name]);
  };
  const spin = () => {
    setView('free');
    animateTo({ az: camera.az + 90, el: camera.el }, 700);
  };
  const fit = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    stop();
    drag.current = { x: e.clientX, y: e.clientY, cam: camera, pan, mode: e.shiftKey || e.button !== 0 ? 'pan' : 'orbit', moved: false };
    suppressClick.current = false;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 4) {
      d.moved = true;
      suppressClick.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (!d.moved) return;
    if (d.mode === 'orbit') {
      setView('free');
      setCamera({ az: d.cam.az - dx * 0.4, el: Math.min(90, Math.max(8, d.cam.el + dy * 0.25)) });
    } else if (rect) {
      const unitsPerPx = ((design.grid.w + design.grid.h) * CELL * 0.75 + 44) / rect.width / zoom;
      setPan({ x: d.pan.x - dx * unitsPerPx, y: d.pan.y - dy * unitsPerPx });
    }
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const onSelect = useCallback(
    (id: string | null) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      select(id ? { type: 'component', id } : null);
    },
    [select],
  );
  const onSelectConnection = useCallback(
    (id: string) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      select({ type: 'connection', id });
    },
    [select],
  );

  const hovered = hover ? compiled.index.byId.get(hover) : undefined;
  const sub = step ? compiled.subBuilds[step.subBuildIndex] : null;
  const selectedId = selection?.type === 'component' ? selection.id : null;
  const selectedConnectionId = selection?.type === 'connection' ? selection.id : null;
  const focusDomain = selection?.type === 'domain' ? selection.id : null;

  if (!design.components.length) {
    return (
      <div className="view view-model is-empty">
        <div className="empty-plate">
          <IsoScene design={{ ...design, grid: { w: 10, h: 8 } }} camera={VIEWS.iso} zoneLabels={false} />
          <p>Describe a system in the chat to start building.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view view-model">
      <div className="toolbar">
        <Segmented
          size="sm"
          label="Camera"
          value={view}
          onChange={(v) => v !== 'free' && goView(v)}
          options={[
            { value: 'iso', label: '3/4', title: 'Three-quarter view' },
            { value: 'front', label: 'Front' },
            { value: 'top', label: 'Top' },
          ]}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={spin} title="Rotate 90°">
          <IconRotate size={14} /> Spin
        </button>
        <span className="toolbar-sep" />
        <button type="button" className={`btn btn-ghost btn-sm${labels ? ' is-on' : ''}`} onClick={() => setLabels((l) => !l)} title="Show every label">
          <IconTag size={14} /> Labels
        </button>
        <Segmented
          size="sm"
          label="Joints"
          value={links}
          onChange={setLinks}
          options={[
            { value: 'all', label: 'All joints' },
            { value: 'business', label: 'Business', title: 'Hide telemetry and auth plumbing' },
            { value: 'none', label: <IconLink size={13} />, title: 'Hide joints' },
          ]}
        />
        {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={fit}>
            Fit
          </button>
        )}
        <span className="toolbar-spacer" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowcase(true)} title="Present the finished model">
          <IconMaximize size={14} /> Showcase
        </button>
      </div>

      <div
        className={`canvas${drag.current?.moved ? ' is-dragging' : ''}`}
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setMouse(null);
          drag.current = null;
        }}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={() => {
          fit();
          goView('iso');
        }}
      >
        <IsoScene
          design={design}
          camera={camera}
          joints={compiled.joints}
          visible={visible}
          highlight={highlight}
          highlightLinks={highlightLinks}
          focusDomain={focusDomain}
          selectedId={selectedId}
          selectedConnectionId={selectedConnectionId}
          hoverId={hover}
          errorIds={errorIds}
          links={links}
          labels={labels ? 'all' : 'auto'}
          zoom={zoom}
          pan={pan}
          animateNew
          onHover={setHover}
          onSelect={onSelect}
          onSelectConnection={onSelectConnection}
        />

        <div className="hud">
          <div className="hud-stat">
            <span className="hud-glyph">⊟</span>
            <span className="hud-num">{formatNumber(compiled.stats.joints)}</span>
            <span className="hud-label">joints</span>
          </div>
          <div className={`hud-stat ${compiled.stats.weakJoints ? 'is-bad' : 'is-ok'}`}>
            {compiled.stats.weakJoints ? <IconAlert size={15} /> : <IconCheck size={15} />}
            <span className="hud-num">{compiled.stats.weakJoints}</span>
            <span className="hud-label">weak {compiled.stats.weakJoints === 1 ? 'joint' : 'joints'}</span>
          </div>
        </div>

        {step && sub && (
          <div className="step-card" key={step.number}>
            <div className="step-card-num">{step.number}</div>
            <div>
              <div className="step-card-sub" style={{ color: sub.color }}>
                Sub-build {sub.index + 1} · {sub.name}
              </div>
              <div className="step-card-title">{step.title}</div>
            </div>
          </div>
        )}

        {hovered && mouse && !drag.current?.moved && (
          <div className="tooltip" style={{ left: mouse.x + 14, top: mouse.y + 14 }}>
            <div className="tooltip-title">{hovered.name}</div>
            <div className="tooltip-sub">
              {KIND_INFO[hovered.kind].label} · {hovered.tech}
            </div>
            <div className="tooltip-row">
              {design.domains.find((d) => d.id === hovered.domainId)?.name} · ×{hovered.replicas} · {hovered.criticality}
            </div>
            {KIND_INFO[hovered.kind].provides.length > 0 && (
              <div className="tooltip-row">
                Studs: {KIND_INFO[hovered.kind].provides.map((p) => PROTOCOL_INFO[p].label).join(', ')}
              </div>
            )}
            <div className="tooltip-row">
              {pluralize((compiled.index.incoming.get(hovered.id) ?? []).length, 'consumer')} ·{' '}
              {pluralize((compiled.index.outgoing.get(hovered.id) ?? []).length, 'dependency', 'dependencies')}
            </div>
            {(compiled.issuesByComponent.get(hovered.id) ?? []).slice(0, 2).map((i) => (
              <div key={i.id} className={`tooltip-issue sev-${i.severity}`}>
                {i.title}
              </div>
            ))}
          </div>
        )}

        <div className="canvas-hint">Drag to orbit · Shift-drag to pan · Scroll to zoom · Double-click to reset</div>
      </div>

      <Timeline
        steps={steps.length}
        value={timelineStep}
        playing={playing}
        speed={speed}
        segments={compiled.subBuilds.map((s) => ({ color: s.color, from: s.firstStep, to: s.lastStep, name: s.name }))}
        label={step ? `Step ${step.number} of ${steps.length} · ${step.title}` : `Finished model · ${pluralize(compiled.stats.components, 'component')}, ${pluralize(steps.length, 'step')}`}
        onChange={(v) => setTimeline(v, false)}
        onPlay={() => {
          if (timelineStep === null) setTimeline(0);
          setPlaying(!playing);
        }}
        onSpeed={setSpeed}
      />
    </div>
  );
}

function Timeline({
  steps,
  value,
  playing,
  speed,
  segments,
  label,
  onChange,
  onPlay,
  onSpeed,
}: {
  steps: number;
  value: number | null;
  playing: boolean;
  speed: number;
  segments: { color: string; from: number; to: number; name: string }[];
  label: string;
  onChange: (v: number | null) => void;
  onPlay: () => void;
  onSpeed: (s: number) => void;
}) {
  const pos = value ?? steps;
  return (
    <div className="timeline">
      <div className="timeline-buttons">
        <button type="button" className="icon-btn" onClick={() => onChange(0)} title="First step">
          <IconSkipBack size={14} />
        </button>
        <button type="button" className="play-btn" onClick={onPlay} title={playing ? 'Pause' : 'Play the build'}>
          {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
        </button>
        <button type="button" className="icon-btn" onClick={() => onChange(null)} title="Finished model">
          <IconSkipForward size={14} />
        </button>
      </div>
      <Segmented size="sm" label="Speed" value={speed} onChange={onSpeed} options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))} />
      <div className="timeline-main">
        <div className="timeline-label">{label}</div>
        <div className="timeline-track">
          <div className="timeline-segments">
            {segments.map((s) => (
              <div key={s.name} className="timeline-seg" title={s.name} style={{ flex: s.to - s.from + 1, background: s.color }} />
            ))}
            <div className="timeline-seg timeline-seg-end" style={{ flex: Math.max(1, steps * 0.02) }} />
          </div>
          <div className="timeline-fill" style={{ width: `${(pos / Math.max(1, steps)) * 100}%` }} />
          <input
            type="range"
            min={0}
            max={steps}
            value={pos}
            aria-label="Build step"
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange(v >= steps ? null : v);
            }}
          />
        </div>
      </div>
      <div className={`timeline-end${value === null ? ' is-on' : ''}`}>Finished</div>
    </div>
  );
}
