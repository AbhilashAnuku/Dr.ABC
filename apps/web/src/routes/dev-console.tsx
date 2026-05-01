import { Card, cn } from '@dr-abc/ui';
import {
  Activity,
  Award,
  Boxes,
  Brain,
  Check,
  Cpu,
  Eye,
  Gauge,
  Heart,
  Network,
  Play,
  Send,
  Settings2,
  Sparkles,
  Terminal,
  X as XIcon,
  Zap,
} from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuditChainBadge } from '../components/dev-console/audit-chain-badge.tsx';
import { BoostingPanel } from '../components/dev-console/boosting-panel.tsx';
import { EnvEditor } from '../components/dev-console/env-editor.tsx';
import { FrontierTab } from '../components/dev-console/frontier-tab.tsx';
import { KgFinetunePanel } from '../components/dev-console/kg-finetune-panel.tsx';
import { KnowledgeGraphPanel } from '../components/dev-console/knowledge-graph-panel.tsx';
import { LearningFlow } from '../components/dev-console/learning-flow.tsx';
import { LiveOpsTab } from '../components/dev-console/live-ops-panel.tsx';
import { ModelComparison } from '../components/dev-console/model-comparison.tsx';
import { MorbiusIntroCard } from '../components/dev-console/morbius-intro-card.tsx';
import { PinGate } from '../components/dev-console/pin-gate.tsx';
import { PipelineFlow } from '../components/dev-console/pipeline-flow.tsx';
import { DevConsolePlayground } from '../components/dev-console/playground.tsx';
import { RehearsalTab } from '../components/dev-console/rehearsal-tab.tsx';
import { ResearchTab } from '../components/dev-console/research-tab.tsx';
import { SecuritySettings } from '../components/dev-console/security-settings.tsx';
import { SentinelsPanel } from '../components/dev-console/sentinels-panel.tsx';
import { SystemFlow } from '../components/dev-console/system-flow.tsx';
import { MobileShareQR } from '../components/mobile-share-qr.tsx';
import { NeuralCoreBootOverlay, useNeuralBoot } from '../components/neural-core/boot-overlay.tsx';
import { useAuth } from '../lib/auth.tsx';
import { API_BASE } from '../lib/config.ts';
import { type Corpus, buildCorpus } from '../lib/training-corpus.ts';

// Lazy-loaded so the dev-console initial bundle stays light. The
// Neural-Core route mounts a Three.js Canvas + boot ceremony — only
// pulled when the tab is actually opened.
const NeuralCorePage = lazy(() =>
  import('./neural-core.tsx').then((m) => ({ default: m.NeuralCorePage })),
);

/**
 * /app/dev-console — first-class developer destination.
 *
 * Five tabs:
 *
 *   1. Pipeline    — full-canvas 3D agent mesh, lights up live
 *   2. Query lab   — multi-line prompt editor + algo / temp / topK knobs
 *   3. Activity    — newest-first tail of /dev/activity (best-effort)
 *   4. Inventory   — /  endpoint snapshot + per-agent metric cards
 *   5. Health      — /health snapshot + py-svc / sink / backend choice
 *
 * Mounted at /app/dev-console. The DevConsoleDrawer in clinic.tsx
 * gives in-context inspection on the consult page; this page is the
 * full-feature spread.
 */

type Tab =
  | 'pipeline'
  | 'rehearsal'
  | 'research'
  | 'frontier'
  | 'system'
  | 'learning'
  | 'env'
  | 'querylab'
  | 'activity'
  | 'inventory'
  | 'health'
  | 'training'
  | 'models'
  | 'introspection'
  | 'neural-core'
  | 'playground'
  | 'kg'
  | 'boosting'
  | 'sentinels'
  | 'kg-finetune'
  | 'liveops';

const ALGORITHMS = [
  { id: 'auto', label: 'Auto · default ensemble' },
  { id: 'anthropic', label: 'Anthropic Claude' },
  { id: 'nvidia', label: 'NVIDIA NIM (free tier)' },
  { id: 'huggingface', label: 'HuggingFace inference' },
  { id: 'ollama', label: 'Ollama (local)' },
];

interface SseEvent {
  type: string;
  agent?: string;
  text?: string;
  ts: number;
  raw?: unknown;
}

interface AgentMeta {
  kind: string;
  version: number;
}

interface ApiRoot {
  name?: string;
  version?: string;
  agents?: AgentMeta[];
}

interface HealthSnapshot {
  ok?: boolean;
  ts?: number;
  diagnosticBackend?: string;
  imagingBackend?: string;
  activitySink?: string;
  agents?: string[];
}

export function DevConsolePage() {
  // Every dev-console entry plays the neural-core boot animation
  // FIRST — the editor-style stepped loader (5 · 19 · 56 · 89 · 97 ·
  // 100) over three seconds — then the PIN gate, then the full
  // cockpit. The boot is silent (no voice intro) so entry into the
  // console does not wait for TTS to finish; the cinematic voice
  // intro remains on the dedicated /app/neural-core route.
  //
  // The boot fires ONCE per session — re-entering dev-console reads
  // sessionStorage and skips straight to the PIN gate (no `force:
  // true`). A 3.6-s failsafe flips bootComplete=true even if `state`
  // somehow gets stuck. A separate storageKey keeps this surface's
  // "booted" flag from fighting with the /app/neural-core route's
  // cinematic boot.
  const { state, progress } = useNeuralBoot({
    durationMs: 3_000,
    silent: true,
    stepped: true,
    storageKey: 'dr-abc:dev-console-booted',
  });
  const [bootComplete, setBootComplete] = useState(state === 'online');

  useEffect(() => {
    if (state === 'online') {
      // Hand-off delay shrunk from 600 ms → 200 ms so the gate appears
      // immediately after the loader hits 100 %.
      const t = window.setTimeout(() => setBootComplete(true), 200);
      return () => window.clearTimeout(t);
    }
    // Failsafe — if the milestone walker stalls (browser throttled the
    // tab, audio context blocked the start, etc.) hand off to the PIN
    // gate after 3.6 s no matter what, so a stuck boot screen is never
    // shown.
    const failsafe = window.setTimeout(() => setBootComplete(true), 3_600);
    return () => window.clearTimeout(failsafe);
  }, [state]);

  if (!bootComplete) {
    return <NeuralCoreBootOverlay state={state} progress={progress} headline="DEV CONSOLE" />;
  }
  return (
    <PinGate>
      <DevConsoleInner />
    </PinGate>
  );
}

// Category-grouped navigation. Each category bundles a few sub-tabs so
// the dev console reads as a story (Live → Research → Health → Tune)
// rather than a flat 11-tab strip. The narrative arc:
//   LIVE      what's happening RIGHT NOW (pipeline · activity · query lab)
//   RESEARCH  the science loop (doctor-brain · models · cycles · schedule)
//   HEALTH    backend diagnostics (system probe · inventory · /health)
//   TUNE      operator controls (env · learning · training corpus)
// Future extenders read the categories first, drop in the new panel
// in the matching category, and the spine still tells one story.
type Category = 'live' | 'research' | 'health' | 'tune';

interface CategorySpec {
  id: Category;
  label: string;
  blurb: string;
  tabs: Array<{ id: Tab; label: string; icon: typeof Network }>;
}

const CATEGORIES: CategorySpec[] = [
  {
    id: 'live',
    label: 'Live',
    blurb: 'rehearsal cockpit · agent mesh · query lab · event tail · per-event drill-down',
    tabs: [
      { id: 'rehearsal', label: 'Rehearsal', icon: Zap },
      { id: 'pipeline', label: 'Pipeline', icon: Network },
      { id: 'querylab', label: 'Query lab', icon: Cpu },
      { id: 'activity', label: 'Activity', icon: Activity },
      { id: 'introspection', label: 'Inspect', icon: Eye },
    ],
  },
  {
    id: 'research',
    label: 'Research',
    blurb: 'doctor-brain · Second Brain · boosting · frontier · benchmarks · neural core',
    tabs: [
      { id: 'research', label: 'Doctor-brain', icon: Brain },
      // "Second Brain" surfaces the knowledge graph as an
      // Obsidian-vault metaphor — Mörbius's long-term memory of facts,
      // growing daily on the diff-aware research-cycle, exposing nodes
      // and raw data (including images). The underlying code keeps the
      // `kg` id so internal refs (knowledge-graph-panel.tsx ·
      // /knowledge-graph endpoint) stay stable.
      { id: 'kg', label: 'Second Brain', icon: Network },
      { id: 'boosting', label: 'Self-correction', icon: Sparkles },
      { id: 'frontier', label: 'Frontier', icon: Zap },
      { id: 'neural-core', label: 'Neural core', icon: Cpu },
      { id: 'playground', label: 'Playground', icon: Zap },
      { id: 'models', label: 'Benchmarks', icon: Award },
    ],
  },
  {
    id: 'health',
    label: 'Health',
    blurb: 'every backend probed in parallel · agent registry · sentinels · live ops',
    tabs: [
      { id: 'system', label: 'System flow', icon: Boxes },
      { id: 'inventory', label: 'Inventory', icon: Boxes },
      { id: 'health', label: 'Snapshot', icon: Heart },
      // Veronica + Aria as strict accuracy + security sentinels.
      // Read-only audit, 15s poll.
      { id: 'sentinels', label: 'Sentinels', icon: Eye },
      // Live-ops: docker container health · migrations applied · per-
      // functionality stats · auto-refresh every 15s.
      { id: 'liveops', label: 'Live ops', icon: Gauge },
    ],
  },
  {
    id: 'tune',
    label: 'Tune',
    blurb: 'env keys · learning loop · training corpus',
    tabs: [
      { id: 'env', label: 'Env', icon: Settings2 },
      { id: 'learning', label: 'Learning', icon: Brain },
      { id: 'training', label: 'Training corpus', icon: Brain },
      { id: 'kg-finetune', label: 'KG fine-tune', icon: Brain },
    ],
  },
];

const CATEGORY_OF: Record<Tab, Category> = {
  rehearsal: 'live',
  pipeline: 'live',
  querylab: 'live',
  activity: 'live',
  introspection: 'live',
  research: 'research',
  kg: 'research',
  boosting: 'research',
  frontier: 'research',
  'neural-core': 'research',
  playground: 'research',
  models: 'research',
  system: 'health',
  inventory: 'health',
  health: 'health',
  sentinels: 'health',
  liveops: 'health',
  env: 'tune',
  learning: 'tune',
  training: 'tune',
  'kg-finetune': 'tune',
};

// Deep-link support: the dashboard / agents-room MetricsHUD / sidebar
// can navigate to a specific tab by pushing `/app/dev-console?tab=<id>`.
// This helper reads the param on mount and feeds it into the initial
// state.
function readInitialTab(): Tab {
  if (typeof window === 'undefined') return 'pipeline';
  try {
    const q = new URLSearchParams(window.location.search).get('tab');
    if (!q) return 'pipeline';
    if (q in CATEGORY_OF) return q as Tab;
  } catch {
    /* ignore */
  }
  return 'pipeline';
}

function DevConsoleInner() {
  const [tab, setTab] = useState<Tab>(readInitialTab);
  // Keep the URL in sync so refreshes / shares land on the same tab.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('tab') !== tab) {
        url.searchParams.set('tab', tab);
        window.history.replaceState(null, '', url.toString());
      }
    } catch {
      /* ignore */
    }
  }, [tab]);
  const activeCategory = CATEGORY_OF[tab];
  const categorySpec =
    CATEGORIES.find((c) => c.id === activeCategory) ?? CATEGORIES[0] ?? CATEGORIES[1];
  const onPickCategory = (id: Category) => {
    const spec = CATEGORIES.find((c) => c.id === id);
    if (!spec) return;
    const first = spec.tabs[0];
    if (first) setTab(first.id);
  };

  // ── pipeline + query state shared across the page ──
  const [activeAgents, setActiveAgents] = useState<ReadonlySet<string>>(new Set());
  const [completedAgents, setCompletedAgents] = useState<ReadonlySet<string>>(new Set());
  const [pickedAgent, setPickedAgent] = useState<string | null>(null);

  const [prompt, setPrompt] = useState('crushing chest pain radiating to left arm');
  const [algo, setAlgo] = useState('auto');
  const [temp, setTemp] = useState(0.4);
  const [topK, setTopK] = useState(5);
  const [streaming, setStreaming] = useState(false);
  const [events, setEvents] = useState<SseEvent[]>([]);
  const [pipelineMs, setPipelineMs] = useState<number | null>(null);

  const submit = useCallback(async () => {
    if (streaming || !prompt.trim()) return;
    setStreaming(true);
    setActiveAgents(new Set());
    setCompletedAgents(new Set());
    setEvents([]);
    setPipelineMs(null);
    const startedAt = performance.now();
    try {
      const res = await fetch(`${API_BASE}/orchestrate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Dr-Abc-Source': 'dev-console-page',
          'X-Dr-Abc-Algo': algo,
          'X-Dr-Abc-Temp': String(temp),
          'X-Dr-Abc-Topk': String(topK),
        },
        body: JSON.stringify({ text: prompt }),
      });
      if (!res.body) throw new Error('no body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(6).trim()) as {
              type?: string;
              agent?: string;
              result?: { agent?: string };
            };
            const agentId =
              ev.agent ??
              ev.result?.agent ??
              (typeof (ev as { agentKind?: string }).agentKind === 'string'
                ? (ev as { agentKind?: string }).agentKind
                : undefined);
            const evt: SseEvent = {
              type: ev.type ?? 'unknown',
              agent: agentId,
              ts: Date.now(),
              raw: ev,
            };
            if (ev.type === 'agent.started' && agentId) {
              setActiveAgents((s) => new Set(s).add(agentId));
            }
            if (ev.type === 'agent.completed' && agentId) {
              setActiveAgents((s) => {
                const next = new Set(s);
                next.delete(agentId);
                return next;
              });
              setCompletedAgents((s) => new Set(s).add(agentId));
            }
            setEvents((evs) => [...evs, evt]);
          } catch {
            /* skip malformed */
          }
        }
      }
    } catch (e) {
      setEvents((evs) => [
        ...evs,
        {
          type: 'error',
          ts: Date.now(),
          text: e instanceof Error ? e.message : String(e),
        },
      ]);
    } finally {
      setStreaming(false);
      setActiveAgents(new Set());
      setPipelineMs(performance.now() - startedAt);
    }
  }, [streaming, prompt, algo, temp, topK]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
            <Terminal className="h-3 w-3" /> · developer console
          </div>
          <h1 className="font-display text-3xl font-bold text-app-primary sm:text-4xl">
            The Mörbius cockpit
          </h1>
          <p className="mt-2 max-w-2xl font-sans text-sm text-app-muted">
            Inspect the pipeline live, fire arbitrary prompts at the agent mesh, tail the activity
            sink, and confirm every backend is online. This is the full version of the drawer
            embedded in the consult page.
          </p>
        </div>
        {/* Audit-chain badge — Ed25519-signed activity log integrity at
            a glance. Stays in the header so its status is visible on
            first paint. */}
        <AuditChainBadge />
        {pipelineMs !== null && (
          <div className="rounded-xl border border-app-subtle bg-white/2 px-4 py-2.5 text-right">
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">
              last run
            </div>
            <div className="font-display text-2xl font-bold text-bio-300 tabular-nums">
              {pipelineMs.toFixed(0)} ms
            </div>
          </div>
        )}
      </header>

      {/* Mörbius self-intro card — top-of-page hero with a Launch
          button + 15 pre-rehearsed defense Q&A chips. Lives above the
          categories nav so it is visible on first paint. */}
      <MorbiusIntroCard />

      {/* Mobile-share QR — anyone on the same Wi-Fi can scan and open
          Mörbius on their own phone. */}
      <MobileShareQR />

      <Card className="p-0">
        {/* Primary nav — 4 categories. Each one tells a chapter of
            the system. Future researchers add panels INTO categories,
            not as a 12th flat tab. */}
        <nav className="flex flex-wrap items-stretch gap-1 border-b border-app-subtle p-2">
          {CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onPickCategory(cat.id)}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-lg border px-3 py-1.5 text-left transition',
                  isActive
                    ? 'border-quantum-400/60 bg-quantum-500/15 shadow-[0_0_25px_-12px_rgba(56,189,248,0.55)]'
                    : 'border-app-subtle bg-white/3 hover:border-quantum-400/30',
                )}
              >
                <span
                  className={cn(
                    'font-display text-sm font-semibold',
                    isActive ? 'text-quantum-200' : 'text-app-primary',
                  )}
                >
                  {cat.label}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-app-faint">
                  {cat.blurb}
                </span>
              </button>
            );
          })}
          <span className="ml-auto inline-flex items-center gap-1.5 self-center font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                streaming ? 'animate-pulse bg-bio-400' : 'bg-app-faint',
              )}
            />
            {streaming
              ? 'streaming'
              : `${activeAgents.size + completedAgents.size} agents · ${events.length} events`}
          </span>
        </nav>
        {/* Secondary nav — sub-tabs of the active category. */}
        {categorySpec && (
          <nav className="flex flex-wrap items-center gap-1 border-b border-app-subtle px-3 py-2">
            {categorySpec.tabs.map((t) => (
              <TabButton key={t.id} tab={t.id} current={tab} onClick={setTab} icon={t.icon}>
                {t.label}
              </TabButton>
            ))}
          </nav>
        )}

        {tab === 'rehearsal' && <RehearsalTab />}
        {tab === 'research' && <ResearchTab />}
        {tab === 'kg' && (
          <div className="p-3">
            <KnowledgeGraphPanel />
          </div>
        )}
        {tab === 'boosting' && <BoostingPanel />}
        {tab === 'frontier' && <FrontierTab />}
        {tab === 'pipeline' && (
          <PipelineTab
            activeAgents={activeAgents}
            completedAgents={completedAgents}
            pickedAgent={pickedAgent}
            setPickedAgent={setPickedAgent}
            events={events}
          />
        )}
        {tab === 'querylab' && (
          <QueryLabTab
            prompt={prompt}
            setPrompt={setPrompt}
            algo={algo}
            setAlgo={setAlgo}
            temp={temp}
            setTemp={setTemp}
            topK={topK}
            setTopK={setTopK}
            streaming={streaming}
            events={events}
            onRun={submit}
          />
        )}
        {tab === 'system' && (
          <div className="p-3">
            <SystemFlow pollMs={10000} />
          </div>
        )}
        {tab === 'learning' && (
          <div className="p-3">
            <LearningFlow />
          </div>
        )}
        {tab === 'env' && (
          <div className="space-y-4 p-3">
            <SecuritySettings />
            <EnvEditor />
          </div>
        )}
        {tab === 'neural-core' && (
          <Suspense
            fallback={
              <div className="flex h-64 items-center justify-center font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
                booting neural core…
              </div>
            }
          >
            <div className="-m-4">
              <NeuralCorePage />
            </div>
          </Suspense>
        )}
        {tab === 'playground' && <DevConsolePlayground />}
        {tab === 'activity' && <ActivityTab />}
        {tab === 'inventory' && <InventoryTab completedAgents={completedAgents} events={events} />}
        {tab === 'health' && <HealthTab />}
        {tab === 'training' && <TrainingTab />}
        {tab === 'models' && <ModelComparison />}
        {tab === 'sentinels' && <SentinelsPanel />}
        {tab === 'kg-finetune' && <KgFinetunePanel />}
        {tab === 'liveops' && <LiveOpsTab />}
        {tab === 'introspection' && (
          <IntrospectionTab
            activeAgents={activeAgents}
            completedAgents={completedAgents}
            events={events}
          />
        )}
      </Card>
    </div>
  );
}

// ============================================================================
//  TAB BUTTON
// ============================================================================

function TabButton({
  tab,
  current,
  onClick,
  icon: Icon,
  children,
}: {
  tab: Tab;
  current: Tab;
  onClick: (t: Tab) => void;
  icon: typeof Network;
  children: React.ReactNode;
}) {
  const active = current === tab;
  return (
    <button
      type="button"
      onClick={() => onClick(tab)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] transition',
        active
          ? 'border-purple-400/40 bg-purple-500/10 text-purple-200'
          : 'border-transparent text-app-muted hover:text-app-primary',
      )}
    >
      <Icon className="h-3 w-3" />
      {children}
    </button>
  );
}

// ============================================================================
//  TAB · PIPELINE — full-width 3D graph + side inspector
// ============================================================================

function PipelineTab({
  activeAgents,
  completedAgents,
  pickedAgent,
  setPickedAgent,
  events,
}: {
  activeAgents: ReadonlySet<string>;
  completedAgents: ReadonlySet<string>;
  pickedAgent: string | null;
  setPickedAgent: (id: string | null) => void;
  events: SseEvent[];
}) {
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1.6fr_1fr]">
      <div className="rounded-xl border border-app-subtle bg-black/40 p-2">
        {/* PipelineFlow is a fixed-grid SVG flowchart — every agent
         *  has a stable slot. The active edges animate (dashflow +
         *  travelling marker) so the eye tracks a request as it flows
         *  through the pipeline in real time. */}
        <div className="h-115 w-full">
          <PipelineFlow
            activeAgents={activeAgents}
            completedAgents={completedAgents}
            onPickAgent={setPickedAgent}
            pickedAgent={pickedAgent}
            className="h-full"
          />
        </div>
      </div>
      <div className="rounded-xl border border-app-subtle bg-black/30 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
            {pickedAgent ? `inspector · ${pickedAgent}` : `live tail · ${events.length} events`}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-bio-300">
            {completedAgents.size} done
          </span>
        </div>
        <div className="max-h-[380px] space-y-1 overflow-y-auto">
          {events.length === 0 ? (
            <p className="font-sans text-xs text-app-muted">
              Open the Query Lab tab and run a prompt — agent events stream here in order.
            </p>
          ) : (
            events
              .filter((e) => !pickedAgent || e.agent === pickedAgent)
              .slice(-40)
              .map((e, i) => (
                <div
                  key={`${e.type}-${e.ts}-${i}`}
                  className="flex items-start gap-2 rounded-md border border-app-subtle/60 bg-white/[0.02] p-1.5 font-mono text-[10px]"
                >
                  <span
                    className={cn(
                      'shrink-0 rounded-sm border px-1 uppercase tracking-[0.18em]',
                      e.type === 'pipeline.completed'
                        ? 'border-bio-500/40 bg-bio-500/10 text-bio-300'
                        : e.type === 'error'
                          ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                          : 'border-purple-400/30 text-purple-200',
                    )}
                  >
                    {e.agent ?? e.type.split('.')[0]}
                  </span>
                  <span className="flex-1 truncate text-app-secondary">{e.type}</span>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
//  TAB · QUERY LAB
// ============================================================================

function QueryLabTab(props: {
  prompt: string;
  setPrompt: (v: string) => void;
  algo: string;
  setAlgo: (v: string) => void;
  temp: number;
  setTemp: (v: number) => void;
  topK: number;
  setTopK: (v: number) => void;
  streaming: boolean;
  events: SseEvent[];
  onRun: () => void;
}) {
  const {
    prompt,
    setPrompt,
    algo,
    setAlgo,
    temp,
    setTemp,
    topK,
    setTopK,
    streaming,
    events,
    onRun,
  } = props;
  const t0 = events[0]?.ts ?? Date.now();
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1fr]">
      <div>
        <div className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-purple-300">
          <Settings2 className="h-3 w-3" /> · custom prompt
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={8}
          className="w-full rounded-lg border border-app-subtle bg-white/5 px-3 py-2 font-mono text-sm text-app-primary placeholder:text-app-faint focus:border-purple-400/60 focus:outline-none"
          placeholder="Describe the case · ask a follow-up · paste a report…"
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">
              algorithm
            </span>
            <select
              value={algo}
              onChange={(e) => setAlgo(e.target.value)}
              className="rounded-md border border-app-subtle bg-white/5 px-2 py-1.5 font-mono text-[11px] text-app-primary focus:border-purple-400/60 focus:outline-none"
            >
              {ALGORITHMS.map((a) => (
                <option key={a.id} value={a.id} className="bg-ink-950">
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">
              temperature · {temp.toFixed(2)}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={temp}
              onChange={(e) => setTemp(Number(e.target.value))}
              className="accent-purple-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">
              top-K · {topK}
            </span>
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              className="accent-blue-500"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={streaming || !prompt.trim()}
          className={cn(
            'mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-mono text-xs uppercase tracking-[0.22em] transition',
            streaming
              ? 'cursor-wait bg-app-subtle text-app-muted'
              : 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500 disabled:opacity-50',
          )}
        >
          {streaming ? (
            <>
              streaming <Play className="h-4 w-4 animate-pulse" />
            </>
          ) : (
            <>
              run query <Send className="h-4 w-4" />
            </>
          )}
        </button>
      </div>

      <div>
        <div className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-blue-300">
          <Activity className="h-3 w-3" /> · SSE stream · {events.length} events
        </div>
        <div className="h-[400px] overflow-y-auto rounded-lg border border-app-subtle bg-black/40 p-3 font-mono text-[11px]">
          {events.length === 0 ? (
            <p className="font-sans text-xs text-app-muted">
              Hit "run query" — every event the orchestrator emits streams here in order, with a
              relative timestamp from the first event.
            </p>
          ) : (
            events.map((e, i) => (
              <div
                key={`${e.type}-${e.ts}-${i}`}
                className="flex items-start gap-2 border-b border-app-subtle/40 py-1 last:border-b-0"
              >
                <span className="w-14 shrink-0 text-app-faint tabular-nums">
                  {((e.ts - t0) / 1000 || 0).toFixed(2)}s
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-sm border px-1 uppercase tracking-[0.18em] text-[9px]',
                    e.type === 'pipeline.completed'
                      ? 'border-bio-500/40 bg-bio-500/10 text-bio-300'
                      : e.type === 'error'
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                        : 'border-purple-400/30 text-purple-200',
                  )}
                >
                  {e.agent ?? e.type.split('.')[0]}
                </span>
                <span className="flex-1 break-all text-app-secondary">{e.type}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
//  TAB · ACTIVITY (fire-and-forget SSE tail)
// ============================================================================

function ActivityTab() {
  const [entries, setEntries] = useState<
    { id: string; ts: number; action: string; status: string; latencyMs?: number; route: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let alive = true;
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${API_BASE}/dev/activity/stream`);
      es.addEventListener('activity', (ev) => {
        if (!alive) return;
        try {
          const entry = JSON.parse((ev as MessageEvent).data);
          setEntries((p) => [entry, ...p].slice(0, 200));
        } catch {
          /* ignore */
        }
      });
      es.onerror = () => {
        if (!alive) return;
        setError(
          "Activity stream offline. The dev sink expects the X-Dr-Abc-Role: developer header — EventSource can't send headers, so this tab is informational until the sink supports query-string auth.",
        );
        es?.close();
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    return () => {
      alive = false;
      es?.close();
    };
  }, []);

  return (
    <div className="p-4">
      <div className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-purple-300">
        <Activity className="h-3 w-3" /> · live activity tail · since{' '}
        {new Date(startedAt.current).toLocaleTimeString()}
      </div>
      {error && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 font-sans text-xs text-amber-200">
          {error}
        </p>
      )}
      <div className="mt-2 max-h-[480px] space-y-1 overflow-y-auto rounded-lg border border-app-subtle bg-black/40 p-3 font-mono text-[11px]">
        {entries.length === 0 && !error && (
          <p className="font-sans text-xs text-app-muted">
            Waiting for the activity sink to emit. Run a consult or a query-lab call to see entries
            stream in.
          </p>
        )}
        {entries.map((e) => (
          <div
            key={e.id}
            className="flex items-start gap-2 border-b border-app-subtle/40 py-1 last:border-b-0"
          >
            <span className="w-20 shrink-0 text-app-faint">
              {new Date(e.ts).toLocaleTimeString()}
            </span>
            <span
              className={cn(
                'shrink-0 rounded-sm border px-1 uppercase tracking-[0.18em] text-[9px]',
                e.status === 'ok'
                  ? 'border-bio-500/40 bg-bio-500/10 text-bio-300'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-300',
              )}
            >
              {e.action}
            </span>
            <span className="flex-1 truncate text-app-secondary">{e.route}</span>
            {typeof e.latencyMs === 'number' && (
              <span className="text-app-faint tabular-nums">{e.latencyMs} ms</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
//  TAB · INVENTORY — every registered agent + per-agent stats
// ============================================================================

function InventoryTab({
  completedAgents,
  events,
}: { completedAgents: ReadonlySet<string>; events: SseEvent[] }) {
  const [meta, setMeta] = useState<AgentMeta[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/`)
      .then((r) => r.json() as Promise<ApiRoot>)
      .then((j) => setMeta(j.agents ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Per-agent quick stats: how many of the most-recent run's events
  // mention each agent. Refreshes whenever Query Lab fires a new run.
  const counts = useMemo(() => {
    const acc = new Map<string, number>();
    for (const e of events) {
      if (e.agent) acc.set(e.agent, (acc.get(e.agent) ?? 0) + 1);
    }
    return acc;
  }, [events]);

  return (
    <div className="p-4">
      <div className="mb-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-purple-300">
        <Boxes className="h-3 w-3" /> · agent inventory · {meta.length} registered
      </div>
      {error && (
        <p className="mb-2 font-mono text-[11px] text-rose-300">API root unreachable: {error}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {meta.length === 0 && !error && (
          <p className="font-sans text-sm text-app-muted">
            Loading agent registry from the API root…
          </p>
        )}
        {meta.map((a) => {
          const fired = completedAgents.has(a.kind);
          const count = counts.get(a.kind) ?? 0;
          return (
            <div
              key={a.kind}
              className={cn(
                'rounded-xl border bg-white/2 p-4 transition',
                fired
                  ? 'border-bio-500/40 shadow-[0_0_30px_-15px_rgba(16,185,129,0.5)]'
                  : 'border-app-subtle',
              )}
            >
              <div className="flex items-baseline justify-between">
                <div className="font-display text-base font-semibold text-app-primary">
                  {a.kind}
                </div>
                <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">
                  v{a.version}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Stat
                  label="status"
                  value={fired ? 'live' : 'idle'}
                  tone={fired ? 'bio' : 'muted'}
                />
                <Stat label="last-run events" value={String(count)} tone="purple" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: { label: string; value: string; tone: 'bio' | 'purple' | 'muted' }) {
  const cls = {
    bio: 'text-bio-300',
    purple: 'text-purple-300',
    muted: 'text-app-muted',
  } as const;
  return (
    <div className="rounded-md border border-app-subtle bg-white/[0.02] px-2 py-1.5">
      <div className={cn('font-display text-base font-bold tabular-nums', cls[tone])}>{value}</div>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">{label}</div>
    </div>
  );
}

// ============================================================================
//  TAB · HEALTH — /health endpoint + nice rendering
// ============================================================================

function HealthTab() {
  const [snap, setSnap] = useState<HealthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number>(Date.now());

  const refresh = useCallback(() => {
    fetch(`${API_BASE}/health`)
      .then((r) => r.json() as Promise<HealthSnapshot>)
      .then((j) => {
        setSnap(j);
        setRefreshedAt(Date.now());
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    refresh();
    const i = setInterval(refresh, 5000);
    return () => clearInterval(i);
  }, [refresh]);

  return (
    <div className="space-y-4 p-4">
      <AuditChainBadge />
      <div className="mb-3 flex items-center justify-between">
        <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-purple-300">
          <Heart className="h-3 w-3" /> · system health · refreshed{' '}
          {new Date(refreshedAt).toLocaleTimeString()}
        </div>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1 rounded-md border border-app-subtle bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted hover:text-app-primary"
        >
          <Zap className="h-3 w-3" /> refresh
        </button>
      </div>
      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 font-mono text-[11px] text-rose-200">
          /health unreachable: {error}
        </p>
      )}
      {snap && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <HealthCard
            title="API server"
            value={snap.ok ? 'online' : 'down'}
            tone={snap.ok ? 'bio' : 'rose'}
            sub={`ts ${snap.ts ? new Date(snap.ts).toLocaleTimeString() : '—'}`}
          />
          <HealthCard
            title="Diagnostic backend"
            value={snap.diagnosticBackend ?? '—'}
            tone={snap.diagnosticBackend === 'offline' ? 'amber' : 'bio'}
            sub="picks Anthropic / NVIDIA / HF / Ollama"
          />
          <HealthCard
            title="Imaging backend"
            value={snap.imagingBackend ?? '—'}
            tone={snap.imagingBackend === 'offline' ? 'amber' : 'bio'}
            sub="MONAI on py-svc · Anthropic Vision · stub fallback"
          />
          <HealthCard
            title="Activity sink"
            value={snap.activitySink ?? '—'}
            tone={snap.activitySink === 'memory' ? 'amber' : 'bio'}
            sub="Postgres when DATABASE_URL is set"
          />
          <HealthCard
            title="Agents registered"
            value={String(snap.agents?.length ?? 0)}
            tone="purple"
            sub={(snap.agents ?? []).join(' · ')}
          />
          <HealthCard
            title="Polling cadence"
            value="5 s"
            tone="muted"
            sub="hot-reload safe · API hold-warm friendly"
          />
        </div>
      )}
    </div>
  );
}

function HealthCard({
  title,
  value,
  sub,
  tone,
}: {
  title: string;
  value: string;
  sub?: string;
  tone: 'bio' | 'amber' | 'rose' | 'purple' | 'muted';
}) {
  const cls = {
    bio: 'border-bio-500/40 text-bio-300',
    amber: 'border-amber-500/40 text-amber-300',
    rose: 'border-rose-500/40 text-rose-300',
    purple: 'border-purple-400/40 text-purple-300',
    muted: 'border-app-subtle text-app-muted',
  } as const;
  return (
    <div className={cn('rounded-xl border bg-white/2 p-4', cls[tone])}>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">{title}</div>
      <div className="mt-1 break-all font-display text-2xl font-bold capitalize">{value}</div>
      {sub && (
        <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          {sub}
        </div>
      )}
    </div>
  );
}

// Tiny no-op so the importer side doesn't tree-shake `Gauge` away if the
// inventory module ever wants it; kept as a deliberate hook for the next
// metrics iteration (CPU / mem trend graphs).
export const _GaugeRef = Gauge;

// ============================================================================
//  TAB · INTROSPECTION — "how Mörbius works" · live + grounded
// ============================================================================

/**
 * IntrospectionTab — answers "how does Mörbius function?" with live
 * data, not marketing prose. Five blocks:
 *
 *   1. The five brain pillars (RAG · Agentic · Medical knowledge ·
 *      Memory · Self-learning) — what each one does + which file
 *      owns it.
 *   2. The orchestration cycle — exactly what happens between
 *      `POST /orchestrate` and the streamed response.
 *   3. The tone pipeline — how every reply gets layered through
 *      HOUSE_TONE + tonePrefix(verdict) + mode + context + user.
 *   4. The continuous-learning loop — corpus → tuner → calibrator →
 *      accuracy harness, with the live counts.
 *   5. The privacy posture — what stays local vs what crosses the
 *      network.
 *
 * Feeds off the `events` from the most recent run so the explanation
 * can be paired with a live trace.
 */
function IntrospectionTab({
  activeAgents,
  completedAgents,
  events,
}: {
  activeAgents: ReadonlySet<string>;
  completedAgents: ReadonlySet<string>;
  events: SseEvent[];
}) {
  const lastRunAgents = useMemo(() => {
    const seen = new Set<string>();
    for (const e of events) {
      if (e.agent) seen.add(e.agent);
    }
    return [...seen];
  }, [events]);
  const tonesObserved = useMemo(() => {
    // The clinic injects HOUSE_TONE + the tonePrefix into every
    // /orchestrate body, so the SSE stream itself doesn't carry tone
    // explicitly. We surface a static reference here + the count of
    // events as a proxy for "the tone layer ran for this run".
    return events.length > 0 ? 'classified · prefix injected before request' : 'idle · no run yet';
  }, [events]);

  return (
    <div className="space-y-5 p-4">
      <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
        <Eye className="h-3 w-3" /> · how Mörbius works · live + grounded
      </div>

      {/* 1. Brain pillars */}
      <Section title="1 · The five brain pillars">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <PillarCard
            id="RAG"
            tone="purple"
            body="Retrieval over the curated medical corpus + live PubMed/clinical-trial fetch."
            owner="packages/agents/src/library.ts · research/"
          />
          <PillarCard
            id="Agentic"
            tone="blue"
            body="Triage routes the case, the picked specialist + cross-validating diagnostic run in parallel, then the gauntlet gates the output."
            owner="packages/morbius-core · packages/agents/specialists"
          />
          <PillarCard
            id="Medical knowledge"
            tone="bio"
            body="ICD-10 / SNOMED-anchored prompts per specialty + standing-order Rx + MONAI imaging."
            owner="packages/agents/specialists/prompts.ts"
          />
          <PillarCard
            id="Memory"
            tone="amber"
            body="Per-user IndexedDB store with TF-cosine recall — every signed-off Rx becomes a future exemplar."
            owner="apps/web/src/lib/morbius-memory.ts"
          />
          <PillarCard
            id="Self-learning"
            tone="rose"
            body="Activity sink → corpus sampler → prompt tuner → validator calibrator → accuracy harness · all architect-approved."
            owner="packages/agents/src/{tuner,calibrator}.ts"
          />
        </div>
      </Section>

      {/* 2. Orchestration cycle */}
      <Section title="2 · What happens on POST /orchestrate">
        <ol className="space-y-2 font-grotesk text-sm text-app-secondary">
          <Step n={1}>
            <strong className="text-app-primary">Receive</strong> · Hono validates the body (text
            required), generates a sessionId, builds the TaskContext.
          </Step>
          <Step n={2}>
            <strong className="text-app-primary">Triage</strong> · the TriageAgent ranks ESI 1-5 +
            classifies intent (symptom · emergency · routine · etc).
          </Step>
          <Step n={3}>
            <strong className="text-app-primary">Route</strong> · Morbius picks the matching
            specialist agent (cardiology · neurology · oncology · pulmonology · endocrinology ·
            dermatology) and always also runs the cross-validating Diagnostic agent.
          </Step>
          <Step n={4}>
            <strong className="text-app-primary">Reason</strong> · the picked agent calls its
            ensemble (Ollama-first by default; cloud is the fallback) + receives the RAG context
            from Library + Research.
          </Step>
          <Step n={5}>
            <strong className="text-app-primary">Secure Pass</strong> · Validator → Safety → Privacy
            gate the output sequentially. Failure at any stage aborts the pipeline + emits
            `pipeline.aborted`.
          </Step>
          <Step n={6}>
            <strong className="text-app-primary">Stream</strong> · every event is pushed to the
            client over SSE in real time + journaled to the activity sink.
          </Step>
        </ol>
      </Section>

      {/* 3. Tone pipeline */}
      <Section title="3 · How every reply is voiced">
        <div className="rounded-xl border border-app-subtle bg-black/30 p-4">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.32em] text-blue-300">
            · prompt-layer order (outermost → innermost)
          </div>
          <ol className="space-y-2 font-grotesk text-sm text-app-secondary">
            <Step n={1}>
              <strong className="text-app-primary">HOUSE_TONE_PREFIX</strong> — Mörbius's persistent
              persona. Locks in "calm, sovereign, no I'm-just-an-AI hedges, numbers always with
              units".
            </Step>
            <Step n={2}>
              <strong className="text-app-primary">tonePrefix(classifyTone(text))</strong> —
              bedside-manner mode classified deterministically from the user's text. Five tones:
              clinical · empathetic · reassuring · conversational · delivering-hard-news.
            </Step>
            <Step n={3}>
              <strong className="text-app-primary">MODE_META[mode].prefix</strong> — analyse · know
              · diet · exercise · psych. The user picks via the brain bar in clinic.
            </Step>
            <Step n={4}>
              <strong className="text-app-primary">Patient context</strong> — vitals · allergies ·
              meds · history · age · sex.
            </Step>
            <Step n={5}>
              <strong className="text-app-primary">User text</strong> — the actual message.
            </Step>
          </ol>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-purple-400/30 bg-purple-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-purple-200">
            tone layer · {tonesObserved}
          </div>
        </div>
      </Section>

      {/* 4. Self-learning loop */}
      <Section title="4 · How Mörbius gets better over time">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <LoopStep
            n={1}
            title="Memory write"
            body="Every signed-off Rx becomes a memory entry with TF embedding (per-user IndexedDB)."
          />
          <LoopStep
            n={2}
            title="Corpus sample"
            body="Stratified sampler buckets by (specialty, ESI tier), keeps the freshest k per bucket."
          />
          <LoopStep
            n={3}
            title="Tune proposal"
            body="Worst-exemplar picker + deterministic refiner produce a prompt diff for architect review."
          />
          <LoopStep
            n={4}
            title="Calibrate gauntlet"
            body="FPR/FNR observed in the activity sink nudges validator/safety/privacy thresholds ±0.05/cycle."
          />
        </div>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          run <code className="text-purple-200">bun run morbius:tune</code> from the repo root, or
          open the <code className="text-purple-200">Training</code> tab to approve/reject proposals
          inline.
        </p>
      </Section>

      {/* 5. Privacy posture */}
      <Section title="5 · What stays local vs what leaves the device">
        <div className="grid gap-3 sm:grid-cols-2">
          <PrivacyCol
            title="Stays local"
            tone="bio"
            items={[
              'Patient record (FHIR-shaped, localStorage)',
              'Mörbius memory (IndexedDB, per-user)',
              'Tune corpus + proposals (IndexedDB)',
              'Speech recognition (Web Speech API, on-device)',
              'Face mirror (MediaPipe, no upload)',
              'Tone classification (deterministic JS)',
            ]}
          />
          <PrivacyCol
            title="Leaves the device only when configured"
            tone="amber"
            items={[
              'Diagnostic reasoning (Ollama → NIM → Claude → HF, in that order)',
              'Imaging analysis (py-svc → MONAI · local-first when py-svc is in the same network)',
              'Translation (py-svc → MarianMT)',
              'PubMed citations (NCBI E-utilities, anonymous)',
              'Activity sink (Postgres when DATABASE_URL is set)',
            ]}
          />
        </div>
      </Section>

      {/* Live trace summary — proves Introspection isn't just docs */}
      <Section title="· Live snapshot">
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="agents fired" value={String(lastRunAgents.length)} tone="purple" />
          <Stat label="active now" value={String(activeAgents.size)} tone="bio" />
          <Stat label="completed" value={String(completedAgents.size)} tone="muted" />
        </div>
        {lastRunAgents.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">
            {lastRunAgents.map((a) => (
              <span
                key={a}
                className={cn(
                  'rounded-full border px-2 py-0.5',
                  completedAgents.has(a)
                    ? 'border-bio-500/40 bg-bio-500/10 text-bio-300'
                    : activeAgents.has(a)
                      ? 'border-purple-400/40 bg-purple-500/10 text-purple-200'
                      : 'border-app-subtle text-app-muted',
                )}
              >
                {a}
              </span>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.32em] text-app-faint">
        {title}
      </div>
      {children}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-purple-400/40 bg-purple-500/10 font-mono text-[10px] text-purple-200">
        {n}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

function PillarCard({
  id,
  tone,
  body,
  owner,
}: {
  id: string;
  tone: 'purple' | 'blue' | 'bio' | 'amber' | 'rose';
  body: string;
  owner: string;
}) {
  const cls = {
    purple: 'border-purple-400/30 from-purple-500/10 text-purple-300',
    blue: 'border-blue-400/30 from-blue-500/10 text-blue-300',
    bio: 'border-bio-500/30 from-bio-500/10 text-bio-300',
    amber: 'border-amber-500/30 from-amber-500/10 text-amber-300',
    rose: 'border-rose-500/30 from-rose-500/10 text-rose-300',
  } as const;
  return (
    <div
      className={cn(
        'rounded-xl border bg-gradient-to-br via-transparent to-transparent p-4',
        cls[tone],
      )}
    >
      <div className="font-display text-base font-bold capitalize">{id}</div>
      <p className="mt-2 font-grotesk text-xs leading-relaxed text-app-secondary">{body}</p>
      <div className="mt-3 break-all font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">
        {owner}
      </div>
    </div>
  );
}

function LoopStep({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-app-subtle bg-white/[0.02] p-3">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          {n.toString().padStart(2, '0')}
        </span>
        <span className="font-display text-sm font-semibold text-app-primary">{title}</span>
      </div>
      <p className="mt-2 font-grotesk text-xs leading-relaxed text-app-muted">{body}</p>
    </div>
  );
}

function PrivacyCol({
  title,
  tone,
  items,
}: { title: string; tone: 'bio' | 'amber'; items: string[] }) {
  const cls =
    tone === 'bio' ? 'border-bio-500/30 text-bio-300' : 'border-amber-500/30 text-amber-300';
  return (
    <div className={cn('rounded-xl border bg-white/[0.02] p-4', cls)}>
      <div className="font-display text-sm font-bold uppercase tracking-wide">{title}</div>
      <ul className="mt-3 space-y-1.5 font-grotesk text-xs leading-relaxed text-app-secondary">
        {items.map((s) => (
          <li key={s} className="flex items-start gap-2">
            <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-current" />
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================
//  TAB · TRAINING — corpus stats + tune proposals + gauntlet thresholds
// ============================================================================

interface TuneProposalView {
  specialty: string;
  currentPrefix: string;
  proposedPrefix: string;
  rationale: string;
  expectedAccuracyDelta: number;
  proposedPrefixChars: number;
  generatedAt: string;
  exemplarCount: number;
}

const PROPOSALS_KEY = 'dr-abc:tune-proposals';
const APPROVED_PREFIX_KEY_PREFIX = 'dr-abc:specialist-prompt';

function loadProposals(): TuneProposalView[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PROPOSALS_KEY);
    return raw ? (JSON.parse(raw) as TuneProposalView[]) : [];
  } catch {
    return [];
  }
}

function saveProposals(p: TuneProposalView[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROPOSALS_KEY, JSON.stringify(p));
  } catch {
    /* quota — ignore */
  }
}

function TrainingTab() {
  const { user } = useAuth();
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [building, setBuilding] = useState(false);
  const [proposals, setProposals] = useState<TuneProposalView[]>(() => loadProposals());
  const [error, setError] = useState<string | null>(null);
  const [thresholds, setThresholds] = useState<Record<string, number> | null>(null);

  const refreshCorpus = useCallback(async () => {
    if (!user?.id) return;
    setBuilding(true);
    setError(null);
    try {
      const c = await buildCorpus(user.id, { perBucketCap: 4 });
      setCorpus(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void refreshCorpus();
  }, [refreshCorpus]);

  // Pull live gauntlet thresholds from /health.
  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((r) => r.json() as Promise<{ gauntletThresholds?: Record<string, number> }>)
      .then((j) => setThresholds(j.gauntletThresholds ?? null))
      .catch(() => setThresholds(null));
  }, []);

  const approve = (i: number) => {
    const p = proposals[i];
    if (!p || typeof window === 'undefined') return;
    window.localStorage.setItem(`${APPROVED_PREFIX_KEY_PREFIX}:${p.specialty}`, p.proposedPrefix);
    const next = proposals.filter((_, idx) => idx !== i);
    setProposals(next);
    saveProposals(next);
  };

  const reject = (i: number) => {
    const next = proposals.filter((_, idx) => idx !== i);
    setProposals(next);
    saveProposals(next);
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
          <Brain className="h-3 w-3" /> · training corpus + tune proposals + gauntlet thresholds
        </div>
        <button
          type="button"
          onClick={() => void refreshCorpus()}
          disabled={building}
          className="inline-flex items-center gap-1 rounded-md border border-app-subtle bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted hover:text-app-primary disabled:opacity-50"
        >
          <Zap className="h-3 w-3" /> {building ? 'building…' : 'rebuild corpus'}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 font-mono text-[11px] text-rose-200">
          {error}
        </p>
      )}

      {/* Corpus stats */}
      {corpus && <CorpusStatsBlock corpus={corpus} />}

      {/* Gauntlet thresholds */}
      {thresholds && <ThresholdsBlock thresholds={thresholds} />}

      {/* Pending tune proposals */}
      <div>
        <div className="mb-2 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-blue-300">
          · pending tune proposals · {proposals.length}
        </div>
        {proposals.length === 0 ? (
          <p className="rounded-lg border border-app-subtle bg-white/2 p-3 font-sans text-xs text-app-muted">
            No proposals queued. Run <code className="text-purple-200">bun run morbius:tune</code>{' '}
            from the repo root to generate proposals from the live corpus, or wait for the scheduled
            tune cycle.
          </p>
        ) : (
          <ul className="space-y-3">
            {proposals.map((p, i) => (
              <ProposalCard
                key={`${p.specialty}-${p.generatedAt}`}
                proposal={p}
                onApprove={() => approve(i)}
                onReject={() => reject(i)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CorpusStatsBlock({ corpus }: { corpus: Corpus }) {
  const specialties = Object.entries(corpus.stats.perSpecialty).sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-xl border border-app-subtle bg-black/30 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-bio-300">
          · corpus snapshot
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          built {new Date(corpus.stats.builtAt).toLocaleTimeString()}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="exemplars" value={String(corpus.stats.totalExemplars)} tone="bio" />
        <StatTile label="memory size" value={String(corpus.stats.sourceMemorySize)} tone="purple" />
        <StatTile label="specialties" value={String(specialties.length)} tone="blue" />
        <StatTile
          label="esi span"
          value={`${Object.values(corpus.stats.perEsiBucket).filter((n) => n > 0).length}/5`}
          tone="amber"
        />
      </div>
      {specialties.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">
            per specialty
          </div>
          <div className="flex flex-wrap gap-1.5">
            {specialties.map(([s, n]) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded-full border border-purple-400/30 bg-purple-500/10 px-2 py-0.5 font-mono text-[10px] text-purple-200"
              >
                {s}
                <span className="font-bold tabular-nums">{n}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: { label: string; value: string; tone: 'bio' | 'purple' | 'blue' | 'amber' }) {
  const cls = {
    bio: 'text-bio-300',
    purple: 'text-purple-300',
    blue: 'text-blue-300',
    amber: 'text-amber-300',
  } as const;
  return (
    <div className="rounded-md border border-app-subtle bg-white/[0.02] p-2.5">
      <div className={cn('font-display text-2xl font-bold tabular-nums', cls[tone])}>{value}</div>
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">{label}</div>
    </div>
  );
}

function ThresholdsBlock({ thresholds }: { thresholds: Record<string, number> }) {
  return (
    <div className="rounded-xl border border-app-subtle bg-black/30 p-4">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300">
        · gauntlet thresholds (live · from /health)
      </div>
      <div className="grid grid-cols-3 gap-2">
        {Object.entries(thresholds).map(([stage, value]) => (
          <div key={stage} className="rounded-md border border-app-subtle bg-white/[0.02] p-2.5">
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">
              {stage}
            </div>
            <div className="mt-1 font-display text-2xl font-bold tabular-nums text-amber-300">
              {value.toFixed(2)}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
        Adjust via <code className="text-amber-200">POST /dev/calibrate</code> with{' '}
        <code className="text-amber-200">X-Dr-Abc-Role: developer</code>.
      </p>
    </div>
  );
}

function ProposalCard({
  proposal,
  onApprove,
  onReject,
}: {
  proposal: TuneProposalView;
  onApprove: () => void;
  onReject: () => void;
}) {
  const diff = simpleDiff(proposal.currentPrefix, proposal.proposedPrefix);
  return (
    <li className="rounded-xl border border-purple-400/30 bg-purple-500/[0.04] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
            · {proposal.specialty} · {proposal.exemplarCount} exemplars
          </div>
          <div className="mt-1 font-display text-base text-app-primary">
            +{proposal.expectedAccuracyDelta.toFixed(1)}pp expected · {proposal.proposedPrefixChars}{' '}
            chars
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReject}
            className="inline-flex items-center gap-1 rounded-md border border-app-subtle bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-rose-300 hover:bg-rose-500/15"
          >
            <XIcon className="h-3 w-3" /> reject
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="inline-flex items-center gap-1 rounded-md border border-bio-500/40 bg-bio-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-bio-300 hover:bg-bio-500/20"
          >
            <Check className="h-3 w-3" /> approve
          </button>
        </div>
      </div>
      <p className="mt-2 font-sans text-xs text-app-secondary">{proposal.rationale}</p>
      <div className="mt-3 max-h-[260px] overflow-y-auto rounded-lg border border-app-subtle bg-black/40 p-3 font-mono text-[11px] leading-relaxed">
        {diff.map((line, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: diff is regenerated per render; index is stable
            key={i}
            className={cn(
              line.kind === 'add' && 'text-bio-300',
              line.kind === 'del' && 'text-rose-300 line-through opacity-60',
              line.kind === 'same' && 'text-app-muted',
            )}
          >
            <span className="select-none mr-1">
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
            </span>
            {line.text}
          </div>
        ))}
      </div>
    </li>
  );
}

interface DiffLine {
  kind: 'add' | 'del' | 'same';
  text: string;
}

/**
 * Tiny line-level diff — adequate for the dev-console preview where
 * the prefixes are 5-15 lines. We split on newline + sentence boundary
 * so a single-line current prompt still produces a readable diff
 * against a multi-line proposal.
 */
function simpleDiff(a: string, b: string): DiffLine[] {
  const split = (s: string) =>
    s
      .split(/\n+|(?<=\.)\s+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  const aLines = split(a);
  const bLines = split(b);
  const aSet = new Set(aLines);
  const bSet = new Set(bLines);
  const out: DiffLine[] = [];
  for (const line of aLines) {
    if (!bSet.has(line)) out.push({ kind: 'del', text: line });
  }
  for (const line of bLines) {
    if (aSet.has(line)) out.push({ kind: 'same', text: line });
    else out.push({ kind: 'add', text: line });
  }
  return out;
}
