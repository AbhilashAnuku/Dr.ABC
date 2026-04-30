import { cn } from '@dr-abc/ui';
import { useMemo } from 'react';

/**
 * PipelineFlow — fixed-position SVG flowchart of the Mörbius pipeline.
 *
 * Replaces the force-directed graph in the dev console with a *stable*
 * visualisation: every agent has a fixed slot, the layout never
 * bounces, and the flow of a request is shown as a travelling marker
 * along the edges that fire.
 *
 * Layout (left → right, fixed grid in viewBox coords):
 *
 *   [Request] → [Triage] → [Diagnostic + 6 Specialists col] → [Validator] → [Safety] → [Privacy] → [Response]
 *
 * Two RAG agents (Library, Research) sit below the reasoning column
 * because they feed the diagnostic/specialist agents in parallel.
 *
 * Visual states per node:
 *   - idle:     muted border, dim label
 *   - active:   pulsing accent ring + glow
 *   - completed: solid accent fill + check tick
 *
 * Edges:
 *   - solid muted line by default
 *   - active edges (source agent currently firing): animated
 *     dashflow + travelling marker that loops along the path
 *   - completed edges: solid bio-green tint
 *
 * Click a node → onPickAgent emits its kind.
 */

export interface PipelineFlowProps {
  activeAgents: ReadonlySet<string>;
  completedAgents: ReadonlySet<string>;
  onPickAgent?: (id: string | null) => void;
  pickedAgent?: string | null;
  className?: string;
}

export interface FlowNode {
  id: string;
  label: string;
  /** Centre coordinates in viewBox space (1000 × 600 by default). */
  x: number;
  y: number;
  /** Stage colour cue. */
  group: 'input' | 'gate' | 'reasoner' | 'specialist' | 'rag' | 'output';
  /** Pixel half-width / half-height — computed from group. */
  w?: number;
  h?: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** Optional curve control offset; positive bows down, negative bows up. */
  bow?: number;
}

// ─────────────────────────────────────────────────────────────────
//  Fixed layout — coordinates in a 1000 × 640 viewBox.
// ─────────────────────────────────────────────────────────────────

const COL_X = {
  input: 60,
  triage: 200,
  reason: 460,
  validator: 700,
  safety: 820,
  privacy: 940,
  output: 940,
} as const;

const REASONER_Y = 80; // Diagnostic
const SPECIALIST_Y_TOP = 160; // Cardiology
const SPECIALIST_GAP = 56; // vertical gap between specialists
const RAG_Y = 540; // Library + Research at the bottom
const GATE_Y_TRIAGE = 320; // Triage centre
const GATE_Y_VALIDATOR = 200;
const GATE_Y_SAFETY = 320;
const GATE_Y_PRIVACY = 320;
const OUTPUT_Y = 440;

export const FLOW_NODES: FlowNode[] = [
  { id: 'input', label: 'Request', x: COL_X.input, y: GATE_Y_TRIAGE, group: 'input' },
  { id: 'triage', label: 'Triage', x: COL_X.triage, y: GATE_Y_TRIAGE, group: 'gate' },

  { id: 'diagnostic', label: 'Diagnostic', x: COL_X.reason, y: REASONER_Y, group: 'reasoner' },
  {
    id: 'cardiology',
    label: 'Cardiology',
    x: COL_X.reason,
    y: SPECIALIST_Y_TOP,
    group: 'specialist',
  },
  {
    id: 'neurology',
    label: 'Neurology',
    x: COL_X.reason,
    y: SPECIALIST_Y_TOP + SPECIALIST_GAP,
    group: 'specialist',
  },
  {
    id: 'oncology',
    label: 'Oncology',
    x: COL_X.reason,
    y: SPECIALIST_Y_TOP + SPECIALIST_GAP * 2,
    group: 'specialist',
  },
  {
    id: 'pulmonology',
    label: 'Pulmonology',
    x: COL_X.reason,
    y: SPECIALIST_Y_TOP + SPECIALIST_GAP * 3,
    group: 'specialist',
  },
  {
    id: 'endocrinology',
    label: 'Endocrinology',
    x: COL_X.reason,
    y: SPECIALIST_Y_TOP + SPECIALIST_GAP * 4,
    group: 'specialist',
  },
  {
    id: 'dermatology',
    label: 'Dermatology',
    x: COL_X.reason,
    y: SPECIALIST_Y_TOP + SPECIALIST_GAP * 5,
    group: 'specialist',
  },

  { id: 'library', label: 'Library · RAG', x: COL_X.reason - 140, y: RAG_Y, group: 'rag' },
  { id: 'research', label: 'Research · PubMed', x: COL_X.reason + 140, y: RAG_Y, group: 'rag' },

  { id: 'validator', label: 'Validator', x: COL_X.validator, y: GATE_Y_VALIDATOR, group: 'gate' },
  { id: 'safety', label: 'Safety', x: COL_X.safety, y: GATE_Y_SAFETY, group: 'gate' },
  { id: 'privacy', label: 'Privacy', x: COL_X.privacy, y: GATE_Y_PRIVACY, group: 'gate' },
  { id: 'response', label: 'Response', x: COL_X.output, y: OUTPUT_Y, group: 'output' },
];

export const FLOW_EDGES: FlowEdge[] = [
  // Input → Triage
  { from: 'input', to: 'triage' },

  // Triage fans out to every reasoner (the orchestrator picks the
  // matching specialist; diagnostic always cross-validates).
  { from: 'triage', to: 'diagnostic' },
  { from: 'triage', to: 'cardiology' },
  { from: 'triage', to: 'neurology' },
  { from: 'triage', to: 'oncology' },
  { from: 'triage', to: 'pulmonology' },
  { from: 'triage', to: 'endocrinology' },
  { from: 'triage', to: 'dermatology' },

  // RAG feeds the diagnostic + specialist columns.
  { from: 'library', to: 'diagnostic' },
  { from: 'research', to: 'diagnostic' },

  // Reasoners → Validator (gauntlet entry point)
  { from: 'diagnostic', to: 'validator' },
  { from: 'cardiology', to: 'validator' },
  { from: 'neurology', to: 'validator' },
  { from: 'oncology', to: 'validator' },
  { from: 'pulmonology', to: 'validator' },
  { from: 'endocrinology', to: 'validator' },
  { from: 'dermatology', to: 'validator' },

  // Gauntlet chain
  { from: 'validator', to: 'safety' },
  { from: 'safety', to: 'privacy' },

  // Privacy clears → Response
  { from: 'privacy', to: 'response' },
];

// ─────────────────────────────────────────────────────────────────
//  Geometry helpers — exported for tests.
// ─────────────────────────────────────────────────────────────────

const NODE_DIMS: Record<FlowNode['group'], { w: number; h: number }> = {
  input: { w: 96, h: 36 },
  gate: { w: 120, h: 36 },
  reasoner: { w: 124, h: 36 },
  specialist: { w: 124, h: 32 },
  rag: { w: 144, h: 32 },
  output: { w: 96, h: 36 },
};

export function nodeBounds(node: FlowNode): { x1: number; y1: number; x2: number; y2: number } {
  const dim = NODE_DIMS[node.group];
  return {
    x1: node.x - dim.w / 2,
    y1: node.y - dim.h / 2,
    x2: node.x + dim.w / 2,
    y2: node.y + dim.h / 2,
  };
}

/** Pick the entry point on a node closest to (fromX, fromY) — keeps
 *  edges from cutting through the middle of the box. */
export function edgeAnchor(
  node: FlowNode,
  fromX: number,
  _fromY: number,
): { x: number; y: number } {
  const b = nodeBounds(node);
  // Prefer the side closest along the X axis since the layout is
  // primarily left → right.
  if (fromX < b.x1) return { x: b.x1, y: node.y };
  if (fromX > b.x2) return { x: b.x2, y: node.y };
  // Otherwise enter from the top.
  return { x: node.x, y: node.y < _fromY ? b.y2 : b.y1 };
}

/** Build an SVG path string for a left-to-right edge. Uses a smooth
 *  cubic curve so multiple incoming edges to the same node don't
 *  overlap visually. */
export function edgePath(from: FlowNode, to: FlowNode): string {
  const a = edgeAnchor(from, to.x, to.y);
  const b = edgeAnchor(to, from.x, from.y);
  const dx = b.x - a.x;
  const cp = Math.max(40, Math.abs(dx) * 0.4);
  return `M ${a.x},${a.y} C ${a.x + cp},${a.y} ${b.x - cp},${b.y} ${b.x},${b.y}`;
}

// ─────────────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────────────

const GROUP_COLOR: Record<FlowNode['group'], string> = {
  input: '#94a3b8', // app-muted
  gate: '#a78bfa', // purple-400
  reasoner: '#60a5fa', // blue-400
  specialist: '#34d399', // bio-400
  rag: '#fbbf24', // amber-400
  output: '#10b981', // bio-500
};

export function PipelineFlow({
  activeAgents,
  completedAgents,
  onPickAgent,
  pickedAgent,
  className,
}: PipelineFlowProps) {
  const nodeIndex = useMemo(() => new Map(FLOW_NODES.map((n) => [n.id, n])), []);

  const edgeStates = useMemo(() => {
    return FLOW_EDGES.map((e) => {
      const source = nodeIndex.get(e.from);
      const target = nodeIndex.get(e.to);
      if (!source || !target) return null;
      const sourceFiring = activeAgents.has(e.from);
      const sourceDone = completedAgents.has(e.from);
      const targetFiring = activeAgents.has(e.to);
      const targetDone = completedAgents.has(e.to);
      const live = sourceFiring && (targetFiring || targetDone);
      const passed = sourceDone && targetDone;
      const path = edgePath(source, target);
      return { e, source, target, live, passed, path };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
  }, [activeAgents, completedAgents, nodeIndex]);

  return (
    <div className={cn('relative h-full w-full', className)}>
      <svg
        viewBox="0 0 1000 640"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Mörbius agent pipeline flow"
        className="h-full w-full"
      >
        <title>Mörbius agent pipeline flow</title>

        {/* Background grid — visual anchor, helps the eye trust the
         *  layout is fixed. Faint enough to not distract. */}
        <defs>
          <pattern id="flow-grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="rgba(167, 139, 250, 0.05)"
              strokeWidth="1"
            />
          </pattern>

          {/* Arrowhead for completed edges */}
          <marker
            id="flow-arrow-done"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#10b981" />
          </marker>

          {/* Arrowhead for live edges */}
          <marker
            id="flow-arrow-live"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#a78bfa" />
          </marker>

          {/* Arrowhead for idle edges */}
          <marker
            id="flow-arrow-idle"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148, 163, 184, 0.4)" />
          </marker>
        </defs>

        <rect width="1000" height="640" fill="url(#flow-grid)" />

        {/* Stage labels — anchor the reader's mental model of the flow */}
        <g
          fontFamily="JetBrains Mono, monospace"
          fontSize="10"
          fill="rgba(148, 163, 184, 0.55)"
          textAnchor="middle"
        >
          <text x={COL_X.input} y={20}>
            INPUT
          </text>
          <text x={COL_X.triage} y={20}>
            TRIAGE
          </text>
          <text x={COL_X.reason} y={20}>
            REASONING
          </text>
          <text x={COL_X.validator} y={20}>
            VALIDATOR
          </text>
          <text x={COL_X.safety} y={20}>
            SAFETY
          </text>
          <text x={COL_X.privacy} y={20}>
            PRIVACY
          </text>
          <text x={COL_X.reason} y={620}>
            RAG
          </text>
        </g>

        {/* Edges — drawn before nodes so nodes paint on top. */}
        <g fill="none">
          {edgeStates.map(({ e, path, live, passed }) => {
            const stroke = live
              ? '#a78bfa'
              : passed
                ? 'rgba(16, 185, 129, 0.55)'
                : 'rgba(148, 163, 184, 0.22)';
            const marker = live
              ? 'url(#flow-arrow-live)'
              : passed
                ? 'url(#flow-arrow-done)'
                : 'url(#flow-arrow-idle)';
            return (
              <g key={`${e.from}-${e.to}`}>
                <path
                  d={path}
                  stroke={stroke}
                  strokeWidth={live ? 1.6 : 1}
                  markerEnd={marker}
                  className={live ? 'animate-dash-flow' : ''}
                  strokeDasharray={live ? '6 6' : undefined}
                />
                {live && <TravellerDot path={path} />}
              </g>
            );
          })}
        </g>

        {/* Nodes */}
        <g>
          {FLOW_NODES.map((n) => (
            <NodeShape
              key={n.id}
              node={n}
              active={activeAgents.has(n.id)}
              completed={completedAgents.has(n.id)}
              picked={pickedAgent === n.id}
              onClick={() => onPickAgent?.(pickedAgent === n.id ? null : n.id)}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

function NodeShape({
  node,
  active,
  completed,
  picked,
  onClick,
}: {
  node: FlowNode;
  active: boolean;
  completed: boolean;
  picked: boolean;
  onClick: () => void;
}) {
  const dim = NODE_DIMS[node.group];
  const baseColor = GROUP_COLOR[node.group];
  const strokeWidth = active || picked ? 1.8 : 1;
  const fill = active ? `${baseColor}33` : completed ? `${baseColor}1A` : 'rgba(10, 22, 40, 0.9)';
  const stroke = active || picked ? baseColor : `${baseColor}66`;

  return (
    <g
      transform={`translate(${node.x - dim.w / 2}, ${node.y - dim.h / 2})`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      // biome-ignore lint/a11y/useSemanticElements: <g> is the natural SVG group; no SVG <button> exists. Keyboard + ARIA wired manually.
      role="button"
      tabIndex={0}
      aria-label={`Inspect ${node.label}`}
      style={{ cursor: 'pointer', outline: 'none' }}
    >
      {/* Halo for active nodes */}
      {active && (
        <rect
          x={-4}
          y={-4}
          width={dim.w + 8}
          height={dim.h + 8}
          rx={10}
          fill="none"
          stroke={baseColor}
          strokeOpacity={0.4}
          strokeWidth={2}
          className="pulse-glow"
        />
      )}

      <rect
        x={0}
        y={0}
        width={dim.w}
        height={dim.h}
        rx={6}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />

      <text
        x={dim.w / 2}
        y={dim.h / 2 + 1}
        fontFamily="Space Grotesk, system-ui, sans-serif"
        fontSize="11"
        fontWeight="500"
        textAnchor="middle"
        dominantBaseline="middle"
        fill={active || completed ? '#f1f5f9' : 'rgba(241, 245, 249, 0.75)'}
      >
        {node.label}
      </text>

      {/* Status tick on the right edge */}
      {completed && !active && <circle cx={dim.w - 8} cy={8} r={3} fill="#10b981" />}
      {active && (
        <circle cx={dim.w - 8} cy={8} r={3} fill={baseColor}>
          <animate attributeName="r" values="3;5;3" dur="1.4s" repeatCount="indefinite" />
        </circle>
      )}
    </g>
  );
}

/**
 * TravellerDot — a small marker that loops along the edge path so the
 * eye tracks the request flowing through the pipeline. Implemented
 * via SVG <animateMotion> which is GPU-accelerated and matches the
 * device refresh rate without a JS frame loop.
 */
function TravellerDot({ path }: { path: string }) {
  return (
    <g>
      <circle r={3} fill="#a78bfa">
        <animateMotion dur="1.6s" repeatCount="indefinite" path={path} rotate="auto" />
      </circle>
    </g>
  );
}
