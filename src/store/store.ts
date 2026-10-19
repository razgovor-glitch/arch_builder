import { create } from 'zustand';
import type { Build, ChatMessage, ChatResult, Design, DesignSource, Version } from '../model/types';
import { nowIso, pluralize, uid } from '../model/util';
import { compile } from '../engine/compile';
import { emptyDesign } from '../engine/ops';
import { generateBlueprint } from '../generator/generate';
import { EDIT_HELP, applyChangeRequest } from '../generator/edit';
import { fetchDesignerStatus, streamDesigner, type DesignerStatus } from '../ai/client';
import type { DesignerRequest } from '../ai/prompt';

export type Tab = 'model' | 'design' | 'manual' | 'parts' | 'checks';
export type Selection = { type: 'component' | 'connection' | 'domain'; id: string };
export type Engine = 'claude' | 'blueprint';

export interface Toast {
  id: string;
  text: string;
  tone: 'info' | 'success' | 'error';
}

interface State {
  builds: Build[];
  activeId: string | null;
  past: Design[];
  future: Design[];
  coalesce: { key: string; at: number } | null;

  tab: Tab;
  leftTab: 'chat' | 'library';
  selection: Selection | null;
  manualPage: number;
  /** Build step shown on the model timeline; null shows the finished model. */
  timelineStep: number | null;
  playing: boolean;
  speed: number;
  composerMode: 'change' | 'new';
  engine: Engine;
  designer: DesignerStatus | null;
  busy: { messageId: string; controller: AbortController } | null;
  showcase: boolean;
  printing: boolean;
  toasts: Toast[];
}

interface Actions {
  /** Asks the dev server whether Claude is configured. */
  init(): void;
  commit(mutate: (d: Design) => Design, opts?: { coalesce?: string }): void;
  undo(): void;
  redo(): void;
  select(sel: Selection | null): void;
  setTab(tab: Tab): void;
  setLeftTab(tab: State['leftTab']): void;
  setManualPage(page: number): void;
  setTimeline(step: number | null, playing?: boolean): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: number): void;
  setComposerMode(mode: State['composerMode']): void;
  setEngine(engine: Engine): void;
  setShowcase(on: boolean): void;
  setPrinting(on: boolean): void;
  toast(text: string, tone?: Toast['tone']): void;
  dismissToast(id: string): void;

  newBuild(): void;
  openBuild(id: string): void;
  deleteBuild(id: string): void;
  duplicateBuild(id: string): void;
  renameBuild(name: string): void;
  importDesign(design: Design): void;
  saveVersion(label?: string, source?: DesignSource): void;
  restoreVersion(versionId: string): void;

  submit(prompt: string, image?: DesignerRequest['image'], imageName?: string): Promise<void>;
  stop(): void;
}

export type Store = State & Actions;

const STORAGE_KEY = 'arch-builder:v1';

export const activeBuild = (s: State): Build | null => s.builds.find((b) => b.id === s.activeId) ?? null;

function makeBuild(design: Design, chat: ChatMessage[] = [], source: DesignSource = 'manual'): Build {
  const now = nowIso();
  const versions: Version[] = design.components.length
    ? [{ id: uid('v'), label: 'Initial build', createdAt: now, source, design }]
    : [];
  return { id: uid('build'), name: design.name, design, versions, chat, createdAt: now, updatedAt: now };
}

function resultFor(design: Design, versionId: string): ChatResult {
  const r = compile(design);
  return {
    versionId,
    title: `Built a ${r.stats.components}-component ${design.name} with ${pluralize(r.stats.subBuilds, 'sub-build')}`,
    summary: design.summary,
    components: r.stats.components,
    steps: r.stats.steps,
    domains: r.stats.subBuilds,
    joints: r.stats.joints,
    weakJoints: r.stats.weakJoints,
    grid: `${design.grid.w}×${design.grid.h}`,
  };
}

const EXAMPLES = [
  'E-commerce marketplace with search, recommendations and a mobile app',
  'Core banking with payments, fraud detection and a mainframe ledger',
  'IoT telemetry platform for a million factory sensors on AWS',
];

function seedBuilds(): Build[] {
  return EXAMPLES.map((prompt) => {
    const { design } = generateBlueprint(prompt);
    const build = makeBuild(design, [], 'blueprint');
    const t = build.createdAt;
    build.chat = [
      { id: uid('m'), role: 'user', text: prompt, createdAt: t },
      {
        id: uid('m'),
        role: 'assistant',
        text: '',
        createdAt: t,
        engine: 'blueprint',
        status: 'done',
        phases: ['Planned the sub-builds', 'Placed every component', 'Checked every joint'],
        result: resultFor(design, build.versions[0].id),
      },
    ];
    return build;
  });
}

function load(): Pick<State, 'builds' | 'activeId'> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { builds: Build[]; activeId: string | null };
    if (!Array.isArray(data.builds)) return null;
    return { builds: data.builds, activeId: data.activeId };
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(state: State) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ builds: state.builds, activeId: state.activeId }));
    } catch {
      // Storage full or unavailable: the session keeps working in memory.
    }
  }, 300);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Saved library, or the example builds on first run. Synchronous so the first render has data. */
function initialLibrary(): Pick<State, 'builds' | 'activeId'> {
  const saved = load();
  if (saved && saved.builds.length) return { builds: saved.builds, activeId: saved.activeId ?? saved.builds[0].id };
  const builds = seedBuilds();
  return { builds, activeId: builds[0].id };
}

let initialized = false;

export const useStore = create<Store>()((set, get) => {
  const patchBuild = (id: string, patch: (b: Build) => Build) =>
    set((s) => ({ builds: s.builds.map((b) => (b.id === id ? patch(b) : b)) }));

  const patchMessage = (buildId: string, messageId: string, patch: Partial<ChatMessage>) =>
    patchBuild(buildId, (b) => ({ ...b, chat: b.chat.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) }));

  const pushPhase = (buildId: string, messageId: string, text: string) =>
    patchBuild(buildId, (b) => ({
      ...b,
      chat: b.chat.map((m) => (m.id === messageId ? { ...m, phases: [...(m.phases ?? []), text].slice(-6) } : m)),
    }));

  /**
   * Replaces the working design with a generated one, records a version and plays the build:
   * a new build from step 1, a change from the first piece it added.
   */
  const adopt = (buildId: string, design: Design, source: DesignSource, label: string, previous?: Design): string => {
    const versionId = uid('v');
    const current = get().builds.find((b) => b.id === buildId);
    set((s) => ({
      past: current && s.activeId === buildId && current.design.components.length ? [...s.past, current.design].slice(-80) : s.past,
      future: [],
      selection: null,
    }));
    patchBuild(buildId, (b) => ({
      ...b,
      name: design.name,
      design,
      versions: [...b.versions, { id: versionId, label, createdAt: nowIso(), source, design }],
      updatedAt: nowIso(),
    }));
    let start: number | null = 0;
    if (previous) {
      const before = new Set(previous.components.map((c) => c.id));
      const installedAt = compile(design).installedAt;
      const added = design.components.filter((c) => !before.has(c.id)).map((c) => installedAt.get(c.id) ?? 0);
      start = added.length ? Math.min(...added) : null;
    }
    set({ tab: 'model', timelineStep: start, playing: start !== null, manualPage: 0 });
    return versionId;
  };

  return {
    ...initialLibrary(),
    past: [],
    future: [],
    coalesce: null,
    tab: 'model',
    leftTab: 'chat',
    selection: null,
    manualPage: 0,
    timelineStep: null,
    playing: false,
    speed: 1,
    composerMode: 'change',
    engine: 'blueprint',
    designer: null,
    busy: null,
    showcase: false,
    printing: false,
    toasts: [],

    init() {
      if (initialized) return;
      initialized = true;
      if (!get().builds.some((b) => b.id === get().activeId)) set({ activeId: get().builds[0]?.id ?? null });
      void fetchDesignerStatus().then((status) => {
        set({ designer: status, engine: status?.available ? 'claude' : 'blueprint' });
      });
    },

    commit(mutate, opts) {
      const s = get();
      const build = activeBuild(s);
      if (!build) return;
      const next = mutate(build.design);
      if (next === build.design) return;
      const now = Date.now();
      const merge = opts?.coalesce && s.coalesce?.key === opts.coalesce && now - s.coalesce.at < 1500;
      set({
        past: merge ? s.past : [...s.past, build.design].slice(-80),
        future: [],
        coalesce: opts?.coalesce ? { key: opts.coalesce, at: now } : null,
      });
      patchBuild(build.id, (b) => ({ ...b, design: next, name: next.name, updatedAt: nowIso() }));
    },

    undo() {
      const s = get();
      const build = activeBuild(s);
      if (!build || !s.past.length) return;
      const prev = s.past[s.past.length - 1];
      set({ past: s.past.slice(0, -1), future: [build.design, ...s.future], coalesce: null });
      patchBuild(build.id, (b) => ({ ...b, design: prev, name: prev.name }));
    },

    redo() {
      const s = get();
      const build = activeBuild(s);
      if (!build || !s.future.length) return;
      const next = s.future[0];
      set({ past: [...s.past, build.design], future: s.future.slice(1), coalesce: null });
      patchBuild(build.id, (b) => ({ ...b, design: next, name: next.name }));
    },

    select: (selection) => set({ selection }),
    setTab: (tab) => set({ tab }),
    setLeftTab: (leftTab) => set({ leftTab }),
    setManualPage: (manualPage) => set({ manualPage: Math.max(0, manualPage) }),
    setTimeline: (timelineStep, playing) => set({ timelineStep, playing: playing ?? get().playing }),
    setPlaying: (playing) => {
      const s = get();
      if (playing && s.timelineStep === null) set({ timelineStep: 0 });
      set({ playing });
    },
    setSpeed: (speed) => set({ speed }),
    setComposerMode: (composerMode) => set({ composerMode }),
    setEngine: (engine) => set({ engine }),
    setShowcase: (showcase) => set({ showcase }),
    setPrinting: (printing) => set({ printing }),
    toast(text, tone = 'info') {
      const id = uid('t');
      set((s) => ({ toasts: [...s.toasts, { id, text, tone }].slice(-4) }));
      setTimeout(() => get().dismissToast(id), tone === 'error' ? 6000 : 3500);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    newBuild() {
      const build = makeBuild(emptyDesign('New build'));
      set((s) => ({
        builds: [build, ...s.builds],
        activeId: build.id,
        past: [],
        future: [],
        selection: null,
        leftTab: 'chat',
        composerMode: 'new',
        timelineStep: null,
        playing: false,
        manualPage: 0,
      }));
    },

    openBuild(id) {
      set({ activeId: id, past: [], future: [], selection: null, timelineStep: null, playing: false, manualPage: 0, leftTab: 'chat', composerMode: 'change' });
    },

    deleteBuild(id) {
      const s = get();
      const builds = s.builds.filter((b) => b.id !== id);
      if (!builds.length) {
        const fresh = makeBuild(emptyDesign('New build'));
        set({ builds: [fresh], activeId: fresh.id, past: [], future: [], selection: null, composerMode: 'new' });
        return;
      }
      set({ builds, activeId: s.activeId === id ? builds[0].id : s.activeId, past: [], future: [], selection: null });
    },

    duplicateBuild(id) {
      const src = get().builds.find((b) => b.id === id);
      if (!src) return;
      const design: Design = { ...src.design, id: uid('design'), name: `${src.design.name} (copy)` };
      const copy = makeBuild(design, [], 'manual');
      set((s) => ({ builds: [copy, ...s.builds], activeId: copy.id, past: [], future: [], selection: null }));
      get().toast(`Duplicated as “${design.name}”`, 'success');
    },

    renameBuild(name) {
      const trimmed = name.trim();
      if (!trimmed) return;
      get().commit((d) => ({ ...d, name: trimmed }), { coalesce: 'rename' });
    },

    importDesign(design) {
      const build = makeBuild({ ...design, id: uid('design') }, [], 'import');
      set((s) => ({ builds: [build, ...s.builds], activeId: build.id, past: [], future: [], selection: null, tab: 'model' }));
      get().toast(`Imported “${design.name}”`, 'success');
    },

    saveVersion(label, source = 'manual') {
      const build = activeBuild(get());
      if (!build) return;
      const version: Version = {
        id: uid('v'),
        label: label ?? `Saved ${new Date().toLocaleString()}`,
        createdAt: nowIso(),
        source,
        design: build.design,
      };
      patchBuild(build.id, (b) => ({ ...b, versions: [...b.versions, version] }));
      get().toast(`Saved version “${version.label}”`, 'success');
    },

    restoreVersion(versionId) {
      const build = activeBuild(get());
      const version = build?.versions.find((v) => v.id === versionId);
      if (!version) return;
      get().commit(() => version.design);
      set({ selection: null, timelineStep: null });
      get().toast(`Restored “${version.label}”`, 'info');
    },

    stop() {
      get().busy?.controller.abort();
    },

    async submit(prompt, image, imageName) {
      const text = prompt.trim();
      if ((!text && !image) || get().busy) return;
      let s = get();
      let build = activeBuild(s);
      const changing = s.composerMode === 'change' && !!build && build.design.components.length > 0;
      if (!changing && build && build.design.components.length > 0) {
        get().newBuild();
        s = get();
        build = activeBuild(s);
      }
      if (!build) {
        get().newBuild();
        build = activeBuild(get())!;
      }
      const buildId = build.id;
      const useClaude = s.engine === 'claude' && !!s.designer?.available;
      const userMsg: ChatMessage = { id: uid('m'), role: 'user', text: text || '(image)', createdAt: nowIso(), imageName };
      const reply: ChatMessage = {
        id: uid('m'),
        role: 'assistant',
        text: '',
        createdAt: nowIso(),
        engine: useClaude ? 'claude' : 'blueprint',
        status: 'working',
        phases: [],
      };
      patchBuild(buildId, (b) => ({ ...b, chat: [...b.chat, userMsg, reply] }));
      const controller = new AbortController();
      set({ busy: { messageId: reply.id, controller }, selection: null });
      const current = build.design;

      try {
        if (useClaude) {
          let finished = false;
          await streamDesigner(
            { mode: changing ? 'change' : 'new', prompt: text, current: changing ? current : null, image: image ?? null },
            (e) => {
              if (e.type === 'phase') pushPhase(buildId, reply.id, e.text);
              else if (e.type === 'progress') patchMessage(buildId, reply.id, { text: `${pluralize(e.components, 'component')} · ${pluralize(e.joints, 'joint')} so far` });
              else if (e.type === 'error') throw new Error(e.message);
              else if (e.type === 'result') {
                finished = true;
                const label = changing ? `Change: ${text.slice(0, 48)}` : 'Initial build';
                const versionId = adopt(buildId, e.design, 'claude', label, changing ? current : undefined);
                const notes = [...e.notes, ...(e.repairs ? [`Reinforced the build ${pluralize(e.repairs, 'time')} after the engine checked it.`] : [])];
                patchMessage(buildId, reply.id, {
                  status: 'done',
                  text: notes.join(' '),
                  result: resultFor(e.design, versionId),
                });
                set({ composerMode: 'change' });
              }
            },
            controller.signal,
          );
          if (!finished && !controller.signal.aborted) throw new Error('The designer stopped without returning a build.');
        } else if (changing) {
          pushPhase(buildId, reply.id, 'Reading the current build…');
          await sleep(350);
          const res = applyChangeRequest(current, text);
          if (!res.ok) {
            patchMessage(buildId, reply.id, {
              status: 'error',
              text: `The offline engine understands short commands. Try:\n• ${EDIT_HELP.slice(0, 6).join('\n• ')}${
                s.designer?.available ? '' : '\n\nConnect Claude (set ANTHROPIC_API_KEY) for free-form changes.'
              }`,
            });
          } else {
            pushPhase(buildId, reply.id, `Applied ${pluralize(res.changes.length, 'change')}`);
            await sleep(250);
            const r = compile(res.design);
            pushPhase(buildId, reply.id, `Checked ${r.stats.joints} joints — ${r.stats.weakJoints} weak`);
            const versionId = adopt(buildId, res.design, 'blueprint', `Change: ${text.slice(0, 48)}`, current);
            patchMessage(buildId, reply.id, {
              status: 'done',
              text: [...res.changes, ...(res.unrecognized.length ? [`Skipped: “${res.unrecognized.join('”, “')}”`] : [])].join('\n'),
              result: resultFor(res.design, versionId),
            });
          }
        } else {
          pushPhase(buildId, reply.id, 'Planning the shape…');
          await sleep(450);
          const { design, plan } = generateBlueprint(text || 'Enterprise platform');
          if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError');
          pushPhase(buildId, reply.id, `Chose ${plan.kits.length + 1} sub-builds for a ${plan.template.name}`);
          await sleep(450);
          pushPhase(buildId, reply.id, `Placed ${design.components.length} components on a ${design.grid.w}×${design.grid.h} baseplate`);
          await sleep(450);
          const r = compile(design);
          pushPhase(buildId, reply.id, `Checked ${r.stats.joints} joints — ${r.stats.weakJoints} weak`);
          if (controller.signal.aborted) throw new DOMException('aborted', 'AbortError');
          const versionId = adopt(buildId, design, 'blueprint', 'Initial build');
          patchMessage(buildId, reply.id, { status: 'done', result: resultFor(design, versionId) });
          set({ composerMode: 'change' });
        }
      } catch (error) {
        const aborted = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
        patchMessage(buildId, reply.id, {
          status: 'error',
          text: aborted ? 'Stopped.' : error instanceof Error ? error.message : String(error),
        });
      } finally {
        set({ busy: null });
      }
    },
  };
});

// Persist the library whenever it changes.
useStore.subscribe((state, prev) => {
  if (state.builds !== prev.builds || state.activeId !== prev.activeId) scheduleSave(state);
});

/** The working design of the active build. */
export const useDesign = (): Design | null => useStore((s) => activeBuild(s)?.design ?? null);
