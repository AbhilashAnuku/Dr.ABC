// TODO(i18n): wrap user-facing strings in t() once a `knowledgeGraph` namespace
// exists in en/de/hi.json. Brand-name labels stay untranslated.
import { Card, cn } from '@dr-abc/ui';
import {
  Brain,
  ExternalLink,
  FileJson,
  GitBranch,
  Layers,
  Radio,
  TrendingUp,
  X as XIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../../lib/config.ts';

/**
 * Knowledge-graph panel for the dev-console Research tab.
 *
 * Surfaces:
 *   - Counts: nodes / edges / sources processed
 *   - Confidence breakdown (EXTRACTED / INFERRED / AMBIGUOUS) — the
 *     graphify honesty signal
 *   - Delta vs yesterday (∆ nodes, ∆ edges) — the learning-impact viz
 *   - Top god nodes (most-connected) — what Mörbius "thinks about most"
 *   - Mini SVG force-layout of the top-30 nodes
 *
 * Reads from GET /knowledge-graph which the api server stitches from
 * `docs/status/medical-graph.json` (built by the daily research-cycle).
 */

interface GraphNode {
  id: string;
  kind: string;
  label: string;
  mentionCount: number;
}

interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
  weight?: number;
}

interface GraphSnapshot {
  ts: number;
  updatedAt: string;
  counts: { nodes: number; edges: number; sources: number };
  breakdown: { byKind: Record<string, number>; byConfidence: Record<string, number> };
  delta: { nodes: number; edges: number; sinceFile: string | null } | null;
  analysis: {
    godNodes: Array<{ id: string; label: string; kind: string; degree: number }>;
    clusters: Array<{ id: string; size: number; topNodes: string[] }>;
    surprises: Array<{ source: string; target: string; relation: string; reason: string }>;
    suggestedQuestions: string[];
  };
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
}

const KIND_TONE: Record<string, string> = {
  condition: 'border-quantum-400/40 bg-quantum-500/10 text-quantum-300',
  symptom: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  drug: 'border-bio-500/40 bg-bio-500/10 text-bio-300',
  specialty: 'border-purple-500/40 bg-purple-500/10 text-purple-300',
  test: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  icd10: 'border-app-subtle bg-white/5 text-app-secondary',
  paper: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
};

const CONFIDENCE_TONE: Record<string, string> = {
  EXTRACTED: 'text-bio-300',
  INFERRED: 'text-quantum-300',
  AMBIGUOUS: 'text-amber-300',
};

export function KnowledgeGraphPanel() {
  const [snap, setSnap] = useState<GraphSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Visualises JSON snapshots: clicking a graph node drills into
  // successive knowledge layers. Selected node drives the 3-layer
  // drill panel; null means no node is open and the panel shows the
  // cluster summary.
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/knowledge-graph`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as GraphSnapshot;
        if (!cancelled) setSnap(j);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'graph unavailable');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (loading && !snap) {
    return (
      <Card className="p-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-app-faint">
          loading Second Brain…
        </div>
      </Card>
    );
  }

  if (error && !snap) {
    return (
      <Card className="p-4">
        <div className="font-display text-sm font-semibold text-app-primary">Second Brain</div>
        <p className="mt-2 font-sans text-xs text-app-muted">
          Second Brain unavailable — {error}. The first cycle hasn't built it yet. Run{' '}
          <code className="font-mono text-[11px] text-app-secondary">
            bun run scripts/research-cycle.ts
          </code>{' '}
          to populate it.
        </p>
      </Card>
    );
  }

  if (!snap) return null;

  const { counts, breakdown, delta, analysis, graph } = snap;
  const totalEdges = Object.values(breakdown.byConfidence).reduce((s, v) => s + v, 0);
  const extractedPct =
    totalEdges > 0 ? Math.round(((breakdown.byConfidence.EXTRACTED ?? 0) / totalEdges) * 100) : 0;

  return (
    <Card className="overflow-hidden p-0">
      <div className="bg-gradient-to-br from-purple-500/10 via-quantum-500/8 to-bio-500/10 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
              <Brain className="h-3.5 w-3.5" /> · second brain · medical knowledge graph
            </div>
            <h3 className="mt-1 font-display text-xl font-semibold text-app-primary">
              Mörbius's Second Brain · what it remembers
            </h3>
            <p className="mt-1 max-w-2xl font-sans text-xs text-app-muted">
              The Obsidian-style long-term memory that grows every day. Every consult and every
              paper becomes nodes (conditions · symptoms · drugs · specialties) and edges
              (presents-with · treated-with · routes-to). Edges are tagged{' '}
              <span className="text-bio-300">EXTRACTED</span> ·{' '}
              <span className="text-quantum-300">INFERRED</span> ·{' '}
              <span className="text-amber-300">AMBIGUOUS</span> so we never bury inference as fact.
              The full vault lives at{' '}
              <code className="text-quantum-300">docs/status/medical-graph.json</code>.
            </p>
          </div>
          {delta && (
            <span
              className={cn(
                'rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em]',
                delta.nodes > 0 || delta.edges > 0
                  ? 'border-bio-500/40 bg-bio-500/10 text-bio-300'
                  : 'border-app-subtle text-app-muted',
              )}
            >
              ✦ since last cycle · +{delta.nodes} nodes · +{delta.edges} edges
            </span>
          )}
        </div>

        {/* KPI strip */}
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <Stat icon={GitBranch} label="Nodes" value={counts.nodes} />
          <Stat icon={Radio} label="Edges" value={counts.edges} />
          <Stat icon={Layers} label="Sources processed" value={counts.sources} />
          <Stat
            icon={TrendingUp}
            label="EXTRACTED %"
            value={`${extractedPct}%`}
            sub="vs INFERRED + AMBIGUOUS"
          />
        </div>

        {/* Confidence breakdown bar */}
        <div className="mt-4">
          <div className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
            <span>edge confidence</span>
            <span>{totalEdges} total</span>
          </div>
          <ConfidenceBar breakdown={breakdown.byConfidence} total={totalEdges} />
        </div>
      </div>

      {/* Top god nodes */}
      <div className="border-t border-app-subtle p-5">
        <h4 className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          God nodes — most connected
        </h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {analysis.godNodes.slice(0, 9).map((g) => (
            <div
              key={g.id}
              className={cn(
                'rounded-lg border px-3 py-2 font-mono text-[11px]',
                KIND_TONE[g.kind] ?? 'border-app-subtle text-app-secondary',
              )}
            >
              <div className="flex items-baseline justify-between">
                <span className="truncate font-display text-sm font-semibold text-app-primary">
                  {g.label}
                </span>
                <span className="ml-2 tabular-nums opacity-70">deg {g.degree}</span>
              </div>
              <div className="mt-0.5 text-[9px] uppercase tracking-[0.18em] opacity-60">
                {g.kind}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tiny SVG graph + 3-layer drill panel */}
      <div className="border-t border-app-subtle p-5">
        <h4 className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          Top-30 graph · click a node to drill into layer 1 → 2 → 3
        </h4>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <MiniGraph
            nodes={graph.nodes.slice(0, 30)}
            edges={graph.edges}
            selectedId={selectedNodeId}
            onSelect={setSelectedNodeId}
          />
          <DrillPanel
            selectedId={selectedNodeId}
            graph={graph}
            updatedAt={snap.updatedAt}
            onClose={() => setSelectedNodeId(null)}
          />
        </div>
      </div>

      {/* JSON snapshot · downloadable raw data */}
      <div className="border-t border-app-subtle p-5">
        <h4 className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          Raw data · the vault behind the visualisation
        </h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <SnapshotLink
            label="medical-graph.json"
            sub="full graph · nodes · edges · per-source provenance"
            href={`${API_BASE}/knowledge-graph`}
          />
          <SnapshotLink
            label="research-snapshot"
            sub="last cycle aggregate · delta · cluster summary"
            href={`${API_BASE}/research/snapshot`}
          />
          <SnapshotLink
            label="boosting-journal"
            sub="every error event · ±0.3 cap · 0.97/day decay"
            href={`${API_BASE}/errors/stats`}
          />
          <SnapshotLink
            label="medqa-aggregate"
            sub="96-cycle accuracy · top-1 · ICD-known · gauntlet pass"
            href={`${API_BASE}/research/medqa-aggregate`}
          />
        </div>
      </div>

      {/* Suggested questions */}
      <div className="border-t border-app-subtle p-5">
        <h4 className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          Suggested follow-up questions · feed into the next training cycle
        </h4>
        <ul className="mt-2 space-y-1">
          {analysis.suggestedQuestions.map((q) => (
            <li
              key={q}
              className="rounded-md border border-app-subtle bg-white/3 px-3 py-2 font-sans text-xs text-app-secondary"
            >
              {q}
            </li>
          ))}
          {analysis.suggestedQuestions.length === 0 && (
            <li className="font-sans text-xs text-app-muted">
              Graph is still small — first questions will surface after the second cycle.
            </li>
          )}
        </ul>
      </div>
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Brain;
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-app-subtle bg-black/30 p-3 backdrop-blur">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-purple-300" />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          {label}
        </span>
      </div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums text-purple-200">
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-app-faint">
          {sub}
        </div>
      )}
    </div>
  );
}

function ConfidenceBar({
  breakdown,
  total,
}: {
  breakdown: Record<string, number>;
  total: number;
}) {
  if (total === 0) {
    return <div className="h-2 w-full rounded-full bg-white/5 ring-1 ring-app-subtle/30" />;
  }
  const e = breakdown.EXTRACTED ?? 0;
  const i = breakdown.INFERRED ?? 0;
  const a = breakdown.AMBIGUOUS ?? 0;
  const ePct = (e / total) * 100;
  const iPct = (i / total) * 100;
  const aPct = (a / total) * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/5 ring-1 ring-app-subtle/30">
        <div className="h-full bg-bio-500/70" style={{ width: `${ePct}%` }} />
        <div className="h-full bg-quantum-500/70" style={{ width: `${iPct}%` }} />
        <div className="h-full bg-amber-500/70" style={{ width: `${aPct}%` }} />
      </div>
      <div className="flex justify-between font-mono text-[9px] uppercase tracking-[0.18em]">
        <span className={CONFIDENCE_TONE.EXTRACTED}>EXTRACTED · {e}</span>
        <span className={CONFIDENCE_TONE.INFERRED}>INFERRED · {i}</span>
        <span className={CONFIDENCE_TONE.AMBIGUOUS}>AMBIGUOUS · {a}</span>
      </div>
    </div>
  );
}

/**
 * Mini SVG force-style layout of the top-N nodes. Pure SVG, no
 * dependency. Uses a ring layout (deterministic) with edge lines for
 * a clear "this is a graph" signal without simulating a real force
 * layout. For the full interactive graph, the dashboard's force-graph
 * route is the destination.
 */
function MiniGraph({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const layout = useMemo(() => {
    const w = 600;
    const h = 320;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) * 0.78;
    const positions = new Map<string, { x: number; y: number }>();
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
      positions.set(n.id, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    });
    return { width: w, height: h, positions };
  }, [nodes]);

  const edgesToDraw = edges.filter(
    (e) => layout.positions.has(e.source) && layout.positions.has(e.target),
  );

  // Edges incident to the selected node — drawn brighter so the focus
  // ring is unmistakable. Neighbours' ids are computed once for the
  // node-render pass below so non-neighbours can dim cleanly.
  const neighbourIds = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set<string>();
    set.add(selectedId);
    for (const e of edges) {
      if (e.source === selectedId) set.add(e.target);
      else if (e.target === selectedId) set.add(e.source);
    }
    return set;
  }, [edges, selectedId]);

  return (
    <div className="overflow-hidden rounded-xl border border-app-subtle bg-black/40 p-2">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="h-[320px] w-full"
        role="img"
        aria-label="Second Brain mini visualisation"
      >
        <title>Second Brain mini visualisation — click a node to drill</title>
        {edgesToDraw.map((e) => {
          const a = layout.positions.get(e.source);
          const b = layout.positions.get(e.target);
          if (!a || !b) return null;
          const isFocus =
            selectedId !== null && (e.source === selectedId || e.target === selectedId);
          const baseStroke =
            e.confidence === 'EXTRACTED'
              ? 'rgba(110, 231, 183, 0.45)'
              : e.confidence === 'INFERRED'
                ? 'rgba(56, 189, 248, 0.4)'
                : 'rgba(245, 158, 11, 0.35)';
          const stroke = isFocus
            ? e.confidence === 'EXTRACTED'
              ? '#34d399'
              : e.confidence === 'INFERRED'
                ? '#38bdf8'
                : '#f59e0b'
            : selectedId !== null
              ? 'rgba(148, 163, 184, 0.12)'
              : baseStroke;
          return (
            <line
              key={`${e.source}-${e.target}-${e.relation}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={stroke}
              strokeWidth={isFocus ? 1.6 : 1}
            />
          );
        })}
        {nodes.map((n) => {
          const p = layout.positions.get(n.id);
          if (!p) return null;
          const isSelected = selectedId === n.id;
          const isNeighbour = neighbourIds?.has(n.id) ?? true;
          const fill =
            n.kind === 'condition'
              ? '#38bdf8'
              : n.kind === 'symptom'
                ? '#f43f5e'
                : n.kind === 'drug'
                  ? '#10b981'
                  : n.kind === 'specialty'
                    ? '#a855f7'
                    : n.kind === 'test'
                      ? '#f59e0b'
                      : '#94a3b8';
          const radius = Math.min(11, 3 + Math.log2(n.mentionCount + 1) * 1.5);
          const opacity = selectedId === null ? 0.85 : isNeighbour ? 1 : 0.18;
          return (
            <g
              key={n.id}
              style={{ cursor: 'pointer', outline: 'none' }}
              tabIndex={0}
              onClick={() => onSelect(isSelected ? null : n.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(isSelected ? null : n.id);
                }
              }}
              aria-label={`Drill into ${n.label}`}
            >
              {isSelected && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={radius + 4}
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth={1.5}
                  opacity={0.9}
                />
              )}
              <circle cx={p.x} cy={p.y} r={radius} fill={fill} fillOpacity={opacity} />
              <text
                x={p.x}
                y={p.y - radius - 4}
                fontSize={9}
                fontFamily="JetBrains Mono, monospace"
                fill={isSelected ? '#fbbf24' : '#cbd5e1'}
                fillOpacity={selectedId === null ? 1 : isNeighbour ? 1 : 0.35}
                textAnchor="middle"
              >
                {n.label.slice(0, 18)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Drill panel — Layer 1 / Layer 2 / Layer 3 around the selected node
// ─────────────────────────────────────────────────────────────────────

interface DrillNeighbour {
  node: GraphNode;
  edge: GraphEdge;
  direction: 'out' | 'in';
}

function DrillPanel({
  selectedId,
  graph,
  updatedAt,
  onClose,
}: {
  selectedId: string | null;
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  updatedAt: string;
  onClose: () => void;
}) {
  const node = useMemo(
    () => graph.nodes.find((n) => n.id === selectedId) ?? null,
    [graph.nodes, selectedId],
  );

  const neighbours = useMemo<DrillNeighbour[]>(() => {
    if (!selectedId) return [];
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const out: DrillNeighbour[] = [];
    for (const e of graph.edges) {
      if (e.source === selectedId) {
        const target = byId.get(e.target);
        if (target) out.push({ node: target, edge: e, direction: 'out' });
      } else if (e.target === selectedId) {
        const source = byId.get(e.source);
        if (source) out.push({ node: source, edge: e, direction: 'in' });
      }
    }
    // Bring EXTRACTED edges first — they're the ground truth.
    out.sort((a, b) => {
      const order = { EXTRACTED: 0, INFERRED: 1, AMBIGUOUS: 2 } as const;
      return order[a.edge.confidence] - order[b.edge.confidence];
    });
    return out;
  }, [graph.edges, graph.nodes, selectedId]);

  if (!node) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-app-subtle bg-black/40 p-4">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          <Layers className="h-3 w-3" /> drill panel
        </div>
        <p className="font-sans text-xs text-app-muted">
          Click a node in the graph on the left to expand its three layers — the node itself, its
          1-hop neighbours grouped by confidence, and the source files that contributed each edge.
        </p>
        <div className="flex flex-col gap-1 font-mono text-[10px] text-app-faint">
          <span>· Layer 1 — the node + kind + mention count</span>
          <span>· Layer 2 — neighbours · relation · confidence tag</span>
          <span>· Layer 3 — source provenance · raw JSON link</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-400/40 bg-amber-500/5 p-4">
      {/* Layer 1 — the node itself */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.32em] text-amber-300">
            layer 1 · selected node
          </div>
          <div className="mt-0.5 font-display text-lg font-bold text-app-primary">{node.label}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-muted">
            {node.kind} · {node.mentionCount} mention{node.mentionCount === 1 ? '' : 's'}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close drill panel"
          className="rounded-md border border-app-subtle bg-black/30 p-1 text-app-muted hover:text-app-primary"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Layer 2 — neighbours */}
      <div className="border-t border-amber-400/20 pt-3">
        <div className="font-mono text-[9px] uppercase tracking-[0.32em] text-amber-300">
          layer 2 · {neighbours.length} neighbour{neighbours.length === 1 ? '' : 's'}
        </div>
        <div className="mt-2 max-h-[180px] space-y-1 overflow-y-auto">
          {neighbours.length === 0 && (
            <div className="font-sans text-[11px] text-app-muted">
              Isolated node — no edges in the current snapshot.
            </div>
          )}
          {neighbours.map(({ node: n, edge, direction }) => (
            <div
              key={`${edge.source}-${edge.target}-${edge.relation}`}
              className={cn(
                'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 font-mono text-[10px]',
                KIND_TONE[n.kind] ?? 'border-app-subtle text-app-secondary',
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-mono text-[9px] uppercase opacity-60">
                  {direction === 'out' ? '→' : '←'}
                </span>
                <span className="truncate font-display text-[12px] font-semibold text-app-primary">
                  {n.label}
                </span>
              </div>
              <div className="flex items-center gap-2 text-right">
                <span className="font-mono text-[9px] text-app-muted">{edge.relation}</span>
                <span
                  className={cn(
                    'font-mono text-[9px] uppercase tracking-[0.18em]',
                    CONFIDENCE_TONE[edge.confidence] ?? 'text-app-muted',
                  )}
                >
                  {edge.confidence.slice(0, 4)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Layer 3 — provenance · source files */}
      <div className="border-t border-amber-400/20 pt-3">
        <div className="font-mono text-[9px] uppercase tracking-[0.32em] text-amber-300">
          layer 3 · source files
        </div>
        <div className="mt-2 flex flex-col gap-1">
          <a
            href={`${API_BASE}/knowledge-graph?focus=${encodeURIComponent(node.id)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-2 rounded-md border border-app-subtle bg-black/30 px-2 py-1.5 font-mono text-[10px] text-quantum-300 hover:bg-black/50"
          >
            <span className="flex items-center gap-2">
              <FileJson className="h-3 w-3" /> medical-graph.json · node entry
            </span>
            <ExternalLink className="h-3 w-3 opacity-60" />
          </a>
          <a
            href="https://github.com/AbhilashAnuku/Dr.ABC/blob/main/docs/status/medical-graph.json"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-2 rounded-md border border-app-subtle bg-black/30 px-2 py-1.5 font-mono text-[10px] text-purple-300 hover:bg-black/50"
          >
            <span className="flex items-center gap-2">
              <FileJson className="h-3 w-3" /> docs/status/medical-graph.json (full vault)
            </span>
            <ExternalLink className="h-3 w-3 opacity-60" />
          </a>
          <a
            href="https://github.com/AbhilashAnuku/Dr.ABC/blob/main/packages/agents/src/knowledge-graph/extract.ts"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-2 rounded-md border border-app-subtle bg-black/30 px-2 py-1.5 font-mono text-[10px] text-bio-300 hover:bg-black/50"
          >
            <span className="flex items-center gap-2">
              <FileJson className="h-3 w-3" /> extract.ts (the graphify pipeline)
            </span>
            <ExternalLink className="h-3 w-3 opacity-60" />
          </a>
        </div>
        <p className="mt-2 font-mono text-[9px] text-app-faint">
          snapshot ts · {new Date(updatedAt).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Snapshot link — surfaces the raw JSON behind the visualisation
// ─────────────────────────────────────────────────────────────────────

function SnapshotLink({ label, sub, href }: { label: string; sub: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-3 rounded-md border border-app-subtle bg-black/30 px-3 py-2 transition-colors hover:bg-black/50"
    >
      <div className="flex items-center gap-2">
        <FileJson className="h-4 w-4 text-quantum-300" />
        <div>
          <div className="font-mono text-[11px] text-app-primary">{label}</div>
          <div className="font-mono text-[9px] text-app-muted">{sub}</div>
        </div>
      </div>
      <ExternalLink className="h-3.5 w-3.5 text-app-faint" />
    </a>
  );
}
