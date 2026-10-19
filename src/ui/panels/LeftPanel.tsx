import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatMessage, Design } from '../../model/types';
import { pluralize } from '../../model/util';
import { compile } from '../../engine/compile';
import { IsoScene } from '../../iso/IsoScene';
import { VIEWS } from '../../iso/camera';
import { fileToImage } from '../../ai/client';
import type { DesignerRequest } from '../../ai/prompt';
import { activeBuild, useStore } from '../../store/store';
import { LazyMount, Segmented } from '../common';
import { IconBook, IconChat, IconCheck, IconCopy, IconImage, IconLibrary, IconPlus, IconSend, IconSpark, IconStop, IconTrash, IconUpload, IconX } from '../icons';

const SUGGESTIONS = [
  'E-commerce marketplace with search, recommendations and a mobile app',
  'Core banking with payments, fraud detection and a mainframe ledger',
  'Hospital patient records with HL7/FHIR integration and a patient app',
  'IoT telemetry platform for a million factory sensors on AWS',
  'Multi-tenant B2B SaaS with SSO, billing and webhooks',
  'Logistics control tower with live tracking and ETAs',
];

export function LeftPanel() {
  const leftTab = useStore((s) => s.leftTab);
  const setLeftTab = useStore((s) => s.setLeftTab);
  return (
    <aside className="left-panel">
      <div className="left-tabs">
        <Segmented
          size="sm"
          label="Panel"
          value={leftTab}
          onChange={setLeftTab}
          options={[
            {
              value: 'chat',
              label: (
                <>
                  <IconChat size={13} /> Chat
                </>
              ),
            },
            {
              value: 'library',
              label: (
                <>
                  <IconLibrary size={13} /> Library
                </>
              ),
            },
          ]}
        />
      </div>
      {leftTab === 'chat' ? <ChatPanel /> : <LibraryPanel />}
    </aside>
  );
}

function ChatPanel() {
  const build = useStore(activeBuild);
  const busy = useStore((s) => s.busy);
  const submit = useStore((s) => s.submit);
  const listRef = useRef<HTMLDivElement>(null);
  const chat = build?.chat ?? [];
  const last = chat.at(-1);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat.length, last?.phases?.length, last?.status, last?.text]);

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef}>
        {chat.length === 0 ? (
          <div className="chat-hero">
            <h2>What should we build?</h2>
            <p>
              Describe a system, a capability or drop in a whiteboard photo. Arch Builder designs it from components where every interface is actually
              connected, checks every joint, then writes the step-by-step rollout manual.
            </p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="suggestion" disabled={!!busy} onClick={() => void submit(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          chat.map((m) => (m.role === 'user' ? <UserBubble key={m.id} m={m} /> : <AssistantCard key={m.id} m={m} working={busy?.messageId === m.id} />))
        )}
      </div>
      <Composer />
    </div>
  );
}

function UserBubble({ m }: { m: ChatMessage }) {
  return (
    <div className="msg-user">
      {m.imageName && (
        <div className="msg-image">
          <IconImage size={12} /> {m.imageName}
        </div>
      )}
      {m.text}
    </div>
  );
}

function AssistantCard({ m, working }: { m: ChatMessage; working: boolean }) {
  const setTab = useStore((s) => s.setTab);
  const setManualPage = useStore((s) => s.setManualPage);
  const restoreVersion = useStore((s) => s.restoreVersion);
  const stop = useStore((s) => s.stop);
  const build = useStore(activeBuild);
  const isCurrent = m.result && build?.versions.at(-1)?.id === m.result.versionId;
  return (
    <div className={`msg-ai${m.status === 'error' ? ' is-error' : ''}`}>
      <div className="msg-ai-head">
        <IconSpark size={13} />
        {m.engine === 'claude' ? 'Claude' : 'Blueprint engine'}
      </div>
      {!!m.phases?.length && (
        <ul className="phases">
          {m.phases.map((p, i) => {
            const active = working && i === m.phases!.length - 1;
            return (
              <li key={i} className={active ? 'is-active' : ''}>
                {active ? <span className="spinner" /> : <IconCheck size={12} />}
                {p}
              </li>
            );
          })}
        </ul>
      )}
      {m.result && (
        <div className="result">
          <div className="result-title">{m.result.title}</div>
          {m.result.summary && <p className="result-summary">{m.result.summary}</p>}
          <div className="result-chips">
            <span className="chip">{pluralize(m.result.steps, 'step')}</span>
            <span className="chip">{m.result.grid} plate</span>
            <span className="chip">{pluralize(m.result.joints, 'joint')}</span>
            <span className={`chip ${m.result.weakJoints ? 'chip-bad' : 'chip-ok'}`}>{m.result.weakJoints} weak</span>
          </div>
          <div className="result-actions">
            <button
              type="button"
              className="btn btn-sm btn-soft"
              onClick={() => {
                setManualPage(0);
                setTab('manual');
              }}
            >
              <IconBook size={13} /> Open manual
            </button>
            {!isCurrent && build?.versions.some((v) => v.id === m.result!.versionId) && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => restoreVersion(m.result!.versionId)}>
                Restore this version
              </button>
            )}
          </div>
        </div>
      )}
      {m.text && <div className="msg-ai-text">{m.text}</div>}
      {working && (
        <button type="button" className="btn btn-sm btn-ghost stop-btn" onClick={stop}>
          <IconStop size={11} /> Stop
        </button>
      )}
    </div>
  );
}

function Composer() {
  const composerMode = useStore((s) => s.composerMode);
  const setComposerMode = useStore((s) => s.setComposerMode);
  const busy = useStore((s) => s.busy);
  const submit = useStore((s) => s.submit);
  const stop = useStore((s) => s.stop);
  const engine = useStore((s) => s.engine);
  const setEngine = useStore((s) => s.setEngine);
  const designer = useStore((s) => s.designer);
  const toast = useStore((s) => s.toast);
  const hasDesign = useStore((s) => (activeBuild(s)?.design.components.length ?? 0) > 0);
  const [text, setText] = useState('');
  const [image, setImage] = useState<{ data: NonNullable<DesignerRequest['image']>; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const claudeReady = engine === 'claude' && !!designer?.available;
  const mode = hasDesign ? composerMode : 'new';

  const send = () => {
    if (busy || (!text.trim() && !image)) return;
    void submit(text, image?.data, image?.name);
    setText('');
    setImage(null);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="composer">
      {hasDesign && (
        <Segmented
          size="sm"
          label="Request mode"
          value={composerMode}
          onChange={setComposerMode}
          options={[
            { value: 'change', label: 'Change this build' },
            { value: 'new', label: 'Start a new build' },
          ]}
        />
      )}
      <textarea
        className="composer-input"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder={
          mode === 'change'
            ? claudeReady
              ? 'Describe what to change…'
              : 'e.g. add fraud detection · scale Order Service to 4 · use MySQL for Orders DB'
            : 'Describe a system to build…'
        }
        aria-label="Message"
      />
      {image && (
        <div className="composer-image">
          <IconImage size={12} /> {image.name}
          <button type="button" className="icon-btn" onClick={() => setImage(null)} aria-label="Remove image">
            <IconX size={12} />
          </button>
        </div>
      )}
      <div className="composer-foot">
        <button
          type="button"
          className="icon-btn"
          disabled={!claudeReady}
          onClick={() => fileRef.current?.click()}
          title={claudeReady ? 'Attach a diagram or whiteboard photo' : 'Image input needs Claude'}
        >
          <IconImage size={16} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              setImage({ data: await fileToImage(file), name: file.name });
            } catch (err) {
              toast(err instanceof Error ? err.message : 'Could not read the image', 'error');
            }
          }}
        />
        <select
          className="engine-select"
          value={claudeReady ? 'claude' : 'blueprint'}
          onChange={(e) => setEngine(e.target.value as 'claude' | 'blueprint')}
          title={designer?.available ? `Claude via ${designer.source}` : 'Set ANTHROPIC_API_KEY in .env to enable Claude'}
          aria-label="Design engine"
        >
          <option value="claude" disabled={!designer?.available}>
            Claude {designer?.model ? `(${designer.model})` : ''}
            {designer?.available ? '' : ' — not configured'}
          </option>
          <option value="blueprint">Offline blueprints</option>
        </select>
        <span className="toolbar-spacer" />
        {busy ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={stop}>
            <IconStop size={11} /> Stop
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={send} disabled={!text.trim() && !image}>
            Send <IconSend size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function LibraryPanel() {
  const builds = useStore((s) => s.builds);
  const activeId = useStore((s) => s.activeId);
  const openBuild = useStore((s) => s.openBuild);
  const newBuild = useStore((s) => s.newBuild);
  const deleteBuild = useStore((s) => s.deleteBuild);
  const duplicateBuild = useStore((s) => s.duplicateBuild);
  const importDesign = useStore((s) => s.importDesign);
  const toast = useStore((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="library">
      <div className="library-actions">
        <button type="button" className="btn btn-sm btn-soft" onClick={newBuild}>
          <IconPlus size={13} /> New build
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => fileRef.current?.click()}>
          <IconUpload size={13} /> Import JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              const design = JSON.parse(await file.text()) as Design;
              if (!Array.isArray(design.components) || !Array.isArray(design.connections) || !Array.isArray(design.domains)) throw new Error();
              importDesign(design);
            } catch {
              toast('That file is not an Arch Builder design', 'error');
            }
          }}
        />
      </div>
      <div className="library-list">
        {builds.map((b) => (
          <LibraryCard
            key={b.id}
            design={b.design}
            active={b.id === activeId}
            updatedAt={b.updatedAt}
            versions={b.versions.length}
            onOpen={() => openBuild(b.id)}
            onDuplicate={() => duplicateBuild(b.id)}
            onDelete={() => {
              if (confirm(`Delete “${b.name}” and its ${b.versions.length} versions?`)) deleteBuild(b.id);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function LibraryCard({
  design,
  active,
  updatedAt,
  versions,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  design: Design;
  active: boolean;
  updatedAt: string;
  versions: number;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const stats = design.components.length ? compile(design).stats : null;
  return (
    <div className={`lib-card${active ? ' is-active' : ''}`}>
      <button type="button" className="lib-open" onClick={onOpen}>
        <LazyMount className="lib-thumb" placeholder={<div className="lib-thumb-ph" />}>
          {design.components.length ? (
            <IsoScene design={design} camera={VIEWS.iso} links="none" labels="none" zoneLabels={false} plateStuds={false} />
          ) : (
            <div className="lib-thumb-ph">Empty</div>
          )}
        </LazyMount>
        <div className="lib-text">
          <div className="lib-name">{design.name}</div>
          <div className="lib-meta">
            {stats ? `${pluralize(stats.components, 'component')} · ${pluralize(stats.steps, 'step')}` : 'Not built yet'}
          </div>
          <div className="lib-meta">
            {new Date(updatedAt).toLocaleDateString()} · {pluralize(versions, 'version')}
            {stats && stats.weakJoints > 0 ? ` · ${stats.weakJoints} weak` : ''}
          </div>
        </div>
      </button>
      <div className="lib-tools">
        <button type="button" className="icon-btn" onClick={onDuplicate} title="Duplicate">
          <IconCopy size={13} />
        </button>
        <button type="button" className="icon-btn" onClick={onDelete} title="Delete">
          <IconTrash size={13} />
        </button>
      </div>
    </div>
  );
}
