import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CATEGORIES, COMPONENT_KINDS, type ArchComponent, type ComponentKind, type Connection, type Design, type Domain } from '../../model/types';
import { CATEGORY_INFO, KIND_INFO, PLATFORM_PROTOCOLS, PROTOCOL_INFO } from '../../model/catalog';
import { withAlpha } from '../../model/util';
import { addComponent, addDomain, connect, moveComponent, moveDomain } from '../../engine/ops';
import { autoLayout } from '../../engine/layout';
import { BrickIcon } from '../../iso/BrickIcon';
import { useStore } from '../../store/store';
import { useWorkspace } from '../common';
import { IconAlert, IconGrid, IconPlus } from '../icons';

const CX = 222;
const CY = 146;
const NODE_W = 188;
const NODE_H = 96;

type BrickNode = Node<{ comp: ArchComponent; errors: number; warnings: number; domain?: Domain }, 'brick'>;
type ZoneNode = Node<{ domain: Domain; cells: { x: number; y: number }[] }, 'zone'>;
type FlowNode = BrickNode | ZoneNode;
type JointEdge = Edge<{ conn: Connection; weak: boolean; reason?: string }, 'joint'>;

const BrickNodeView = memo(function BrickNodeView({ data, selected }: NodeProps<BrickNode>) {
  const { comp, errors, warnings, domain } = data;
  const info = KIND_INFO[comp.kind];
  const color = CATEGORY_INFO[info.category].color;
  return (
    <div className={`brick-node${selected ? ' is-selected' : ''}${errors ? ' has-errors' : ''}`} style={{ ['--cat' as string]: color }}>
      <Handle type="source" position={Position.Top} className="brick-handle brick-handle-source" />
      <div className="brick-node-head">
        <BrickIcon kind={comp.kind} replicas={comp.replicas} size={34} />
        <div className="brick-node-text">
          <div className="brick-node-name" title={comp.name}>
            {comp.name}
          </div>
          <div className="brick-node-tech" title={comp.tech}>
            {comp.tech}
          </div>
        </div>
        {comp.replicas > 1 && <span className="brick-node-replicas">×{comp.replicas}</span>}
      </div>
      <div className="brick-node-foot">
        <span className="brick-node-kind" style={{ color: domain?.color }}>
          {info.label}
        </span>
        {(errors > 0 || warnings > 0) && (
          <span className={`brick-node-issues ${errors ? 'sev-error' : 'sev-warning'}`}>
            <IconAlert size={11} /> {errors || warnings}
          </span>
        )}
        <span className="brick-node-studs">
          {info.provides.map((p) => (
            <span key={p} className="stud-chip" style={{ background: PROTOCOL_INFO[p].color }} title={`Provides ${PROTOCOL_INFO[p].label}`} />
          ))}
        </span>
      </div>
      <Handle type="target" position={Position.Bottom} className="brick-handle brick-handle-target" />
    </div>
  );
});

const ZoneNodeView = memo(function ZoneNodeView({ data, selected }: NodeProps<ZoneNode>) {
  return (
    <div
      className={`zone-node${selected ? ' is-selected' : ''}`}
      style={{ background: withAlpha(data.domain.color, 0.07), borderColor: withAlpha(data.domain.color, selected ? 0.9 : 0.45) }}
    >
      <div className="zone-node-label" style={{ color: data.domain.color }}>
        {data.domain.name}
      </div>
    </div>
  );
});

function JointEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<JointEdge>) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  if (!data) return null;
  const color = data.weak ? '#e5484d' : PROTOCOL_INFO[data.conn.protocol].color;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={14}
        style={{ stroke: color, strokeWidth: selected ? 2.6 : 1.6, strokeDasharray: data.weak ? '6 4' : undefined, opacity: selected ? 1 : 0.85 }}
      />
      <EdgeLabelRenderer>
        <div
          className={`joint-label nodrag nopan${selected ? ' is-selected' : ''}${data.weak ? ' is-weak' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, borderColor: color, color }}
          title={data.reason ?? data.conn.label}
          onClick={() => useStore.getState().select({ type: 'connection', id: data.conn.id })}
        >
          {data.weak && <IconAlert size={10} />}
          {PROTOCOL_INFO[data.conn.protocol].label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { brick: BrickNodeView, zone: ZoneNodeView };
const edgeTypes = { joint: JointEdgeView };

function zoneRect(cells: { x: number; y: number }[]) {
  const minX = Math.min(...cells.map((c) => c.x));
  const maxX = Math.max(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  const maxY = Math.max(...cells.map((c) => c.y));
  return {
    x: minX * CX - 20,
    y: minY * CY - 40,
    width: (maxX - minX) * CX + NODE_W + 40,
    height: (maxY - minY) * CY + NODE_H + 60,
  };
}

function Canvas() {
  const { design, compiled } = useWorkspace();
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const { screenToFlowPosition } = useReactFlow();
  const [plumbing, setPlumbing] = useState(false);
  const dragStart = useRef<{ zone: { x: number; y: number }; members: Map<string, { x: number; y: number }> } | null>(null);

  const buildNodes = useCallback((): FlowNode[] => {
    const zones: ZoneNode[] = design.domains
      .map((d) => ({ d, cells: design.components.filter((c) => c.domainId === d.id).map((c) => ({ x: c.x, y: c.y })) }))
      .filter((z) => z.cells.length)
      .map(({ d, cells }) => {
        const r = zoneRect(cells);
        return {
          id: `zone:${d.id}`,
          type: 'zone',
          position: { x: r.x, y: r.y },
          style: { width: r.width, height: r.height },
          data: { domain: d, cells },
          zIndex: -1,
          selected: selection?.type === 'domain' && selection.id === d.id,
          dragHandle: '.zone-node-label',
        };
      });
    const bricks: BrickNode[] = design.components.map((c) => {
      const issues = compiled.issuesByComponent.get(c.id) ?? [];
      return {
        id: c.id,
        type: 'brick',
        position: { x: c.x * CX, y: c.y * CY },
        data: {
          comp: c,
          errors: issues.filter((i) => i.severity === 'error').length,
          warnings: issues.filter((i) => i.severity === 'warning').length,
          domain: design.domains.find((d) => d.id === c.domainId),
        },
        selected: selection?.type === 'component' && selection.id === c.id,
        width: NODE_W,
        height: NODE_H,
      };
    });
    return [...zones, ...bricks];
  }, [design, compiled, selection]);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(buildNodes());
  useEffect(() => setNodes(buildNodes()), [buildNodes, setNodes]);

  const edges = useMemo<JointEdge[]>(
    () =>
      design.connections
        .filter((c) => plumbing || !PLATFORM_PROTOCOLS.has(c.protocol) || (selection?.type === 'connection' && selection.id === c.id))
        .map((c) => {
          const joint = compiled.joints.get(c.id);
          return {
            id: c.id,
            source: c.from,
            target: c.to,
            type: 'joint',
            data: { conn: c, weak: joint?.status === 'weak', reason: joint?.reason },
            selected: selection?.type === 'connection' && selection.id === c.id,
          };
        }),
    [design.connections, compiled.joints, plumbing, selection],
  );
  const hiddenPlumbing = plumbing ? 0 : design.connections.filter((c) => PLATFORM_PROTOCOLS.has(c.protocol)).length;

  const onConnect: OnConnect = useCallback(
    (params) => {
      if (!params.source || !params.target || params.source === params.target) return;
      let made: Connection | null = null;
      commit((d) => {
        const res = connect(d, params.source, params.target);
        made = res.connection;
        return res.design;
      });
      const conn = made as Connection | null;
      if (conn) {
        const a = design.components.find((c) => c.id === conn.from)!;
        const b = design.components.find((c) => c.id === conn.to)!;
        const grips = KIND_INFO[b.kind].provides.includes(conn.protocol) && KIND_INFO[a.kind].consumes.includes(conn.protocol);
        toast(
          grips
            ? `${a.name} → ${b.name} over ${PROTOCOL_INFO[conn.protocol].label}`
            : `Weak joint: ${b.name} exposes nothing ${a.name} can speak`,
          grips ? 'success' : 'error',
        );
        select({ type: 'connection', id: conn.id });
      }
    },
    [commit, design.components, select, toast],
  );

  const onNodeDragStart = useCallback(
    (_: unknown, node: FlowNode) => {
      if (node.type !== 'zone') return;
      const members = new Map<string, { x: number; y: number }>();
      for (const n of nodes) if (n.type === 'brick' && n.data.comp.domainId === node.data.domain.id) members.set(n.id, n.position);
      dragStart.current = { zone: node.position, members };
    },
    [nodes],
  );

  const onNodeDrag = useCallback(
    (_: unknown, node: FlowNode) => {
      const start = dragStart.current;
      if (node.type !== 'zone' || !start) return;
      const dx = node.position.x - start.zone.x;
      const dy = node.position.y - start.zone.y;
      setNodes((ns) => ns.map((n) => (start.members.has(n.id) ? { ...n, position: { x: start.members.get(n.id)!.x + dx, y: start.members.get(n.id)!.y + dy } } : n)));
    },
    [setNodes],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: FlowNode) => {
      if (node.type === 'zone') {
        const start = dragStart.current;
        dragStart.current = null;
        if (!start) return;
        const dx = Math.round((node.position.x - start.zone.x) / CX);
        const dy = Math.round((node.position.y - start.zone.y) / CY);
        const next = moveDomain(design, node.data.domain.id, dx, dy);
        if (!next) {
          toast(`${node.data.domain.name} would collide with another sub-build`, 'error');
          setNodes(buildNodes());
          return;
        }
        if (next === design) setNodes(buildNodes());
        else commit(() => next);
        return;
      }
      const x = Math.round(node.position.x / CX);
      const y = Math.round(node.position.y / CY);
      const comp = node.data.comp;
      if (comp.x === x && comp.y === y) {
        setNodes(buildNodes());
        return;
      }
      commit((d) => moveComponent(d, comp.id, x, y));
    },
    [design, commit, toast, setNodes, buildNodes],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData('application/x-arch-kind') as ComponentKind;
      if (!kind || !KIND_INFO[kind]) return;
      const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const cell = { x: Math.max(0, Math.round((pos.x - NODE_W / 2) / CX)), y: Math.max(0, Math.round((pos.y - NODE_H / 2) / CY)) };
      let created: string | null = null;
      commit((d) => {
        let next = d;
        let domainId = pickDomain(next, cell, selection);
        if (!domainId) {
          const res = addDomain(next, 'General');
          next = res.design;
          domainId = res.domain.id;
        }
        const res = addComponent(next, { kind, domainId }, cell);
        created = res.component.id;
        return res.design;
      });
      if (created) select({ type: 'component', id: created });
    },
    [commit, screenToFlowPosition, select, selection],
  );

  return (
    <div className="design-canvas" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(_, n) => select(n.type === 'zone' ? { type: 'domain', id: n.data.domain.id } : { type: 'component', id: n.id })}
        onEdgeClick={(_, edge) => select({ type: 'connection', id: edge.id })}
        onPaneClick={() => select(null)}
        isValidConnection={(c) => c.source !== c.target && !c.source.startsWith('zone:') && !c.target.startsWith('zone:')}
        deleteKeyCode={null}
        snapToGrid
        snapGrid={[CX / 4, CY / 4]}
        fitView
        fitViewOptions={{ padding: 0.08, minZoom: 0.5 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={[CX / 2, CY / 2]} size={1.6} color="#cfcabf" />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          nodeColor={(n) => (n.type === 'zone' ? withAlpha((n as ZoneNode).data.domain.color, 0.25) : CATEGORY_INFO[KIND_INFO[(n as BrickNode).data.comp.kind].category].color)}
          maskColor="rgba(245, 243, 238, 0.7)"
        />
      </ReactFlow>
      <div className="design-overlay">
        <button type="button" className={`btn btn-ghost btn-sm${plumbing ? ' is-on' : ''}`} onClick={() => setPlumbing((p) => !p)}>
          {plumbing ? 'Hide' : 'Show'} plumbing joints{hiddenPlumbing ? ` (${hiddenPlumbing})` : ''}
        </button>
      </div>
    </div>
  );
}

function pickDomain(design: Design, cell: { x: number; y: number }, selection: { type: string; id: string } | null): string | null {
  // Inside a district?
  for (const d of design.domains) {
    const cells = design.components.filter((c) => c.domainId === d.id);
    if (!cells.length) continue;
    const minX = Math.min(...cells.map((c) => c.x));
    const maxX = Math.max(...cells.map((c) => c.x));
    const minY = Math.min(...cells.map((c) => c.y));
    const maxY = Math.max(...cells.map((c) => c.y));
    if (cell.x >= minX && cell.x <= maxX && cell.y >= minY && cell.y <= maxY) return d.id;
  }
  if (selection?.type === 'domain') return selection.id;
  if (selection?.type === 'component') return design.components.find((c) => c.id === selection.id)?.domainId ?? null;
  // Nearest district.
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of design.components) {
    const dist = Math.hypot(c.x - cell.x, c.y - cell.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = c.domainId;
    }
  }
  return best ?? design.domains[0]?.id ?? null;
}

function Palette() {
  const commit = useStore((s) => s.commit);
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const add = (kind: ComponentKind) => {
    let created: string | null = null;
    commit((d) => {
      let next = d;
      let domainId =
        selection?.type === 'domain'
          ? selection.id
          : selection?.type === 'component'
            ? d.components.find((c) => c.id === selection.id)?.domainId
            : d.domains.find((x) => !['platform-security', 'edge-access', 'integration-backbone', 'channels'].includes(x.id))?.id ?? d.domains[0]?.id;
      if (!domainId) {
        const res = addDomain(next, 'General');
        next = res.design;
        domainId = res.domain.id;
      }
      const res = addComponent(next, { kind, domainId });
      created = res.component.id;
      return res.design;
    });
    if (created) select({ type: 'component', id: created });
  };

  return (
    <aside className="palette">
      <div className="palette-head">
        <div className="panel-title">Pieces</div>
        <input className="input input-sm" placeholder="Filter…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="palette-body">
        {CATEGORIES.map((cat) => {
          const kinds = COMPONENT_KINDS.filter((k) => KIND_INFO[k].category === cat).filter(
            (k) => !q || KIND_INFO[k].label.toLowerCase().includes(q) || KIND_INFO[k].synonyms.some((s) => s.includes(q)),
          );
          if (!kinds.length) return null;
          return (
            <div key={cat} className="palette-group">
              <div className="palette-cat" style={{ color: CATEGORY_INFO[cat].color }}>
                {CATEGORY_INFO[cat].label}
              </div>
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="palette-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-arch-kind', k);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => add(k)}
                  title={`Provides: ${KIND_INFO[k].provides.map((p) => PROTOCOL_INFO[p].label).join(', ') || 'nothing (client)'}\nDrag onto the canvas or click to add`}
                >
                  <BrickIcon kind={k} size={26} />
                  <span>{KIND_INFO[k].label}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export function DesignView() {
  const { design } = useWorkspace();
  const commit = useStore((s) => s.commit);
  const select = useStore((s) => s.select);
  const toast = useStore((s) => s.toast);
  return (
    <div className="view view-design">
      <div className="toolbar">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            let id = '';
            commit((d) => {
              const res = addDomain(d, `Sub-build ${d.domains.length + 1}`);
              id = res.domain.id;
              return res.design;
            });
            select({ type: 'domain', id });
            toast('New sub-build: drop pieces into it, or select it and click a piece', 'info');
          }}
        >
          <IconPlus size={14} /> Sub-build
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => commit((d) => autoLayout(d))} title="Re-pack every district on the baseplate">
          <IconGrid size={14} /> Auto-layout
        </button>
        <span className="toolbar-spacer" />
        <span className="toolbar-hint">Drag from a piece's top handle to the bottom of what it depends on. Delete removes the selection.</span>
      </div>
      <div className="design-body">
        <Palette />
        <ReactFlowProvider key={design.id}>
          <Canvas />
        </ReactFlowProvider>
      </div>
      <ProtocolLegend />
    </div>
  );
}

function ProtocolLegend() {
  const { design } = useWorkspace();
  const used = [...new Set(design.connections.map((c) => c.protocol))];
  if (!used.length) return null;
  return (
    <div className="legend">
      {used.map((p) => (
        <span key={p} className="legend-item">
          <span className="legend-swatch" style={{ background: PROTOCOL_INFO[p].color }} />
          {PROTOCOL_INFO[p].label}
        </span>
      ))}
      <span className="legend-item">
        <span className="legend-swatch legend-weak" />
        Weak joint
      </span>
    </div>
  );
}
