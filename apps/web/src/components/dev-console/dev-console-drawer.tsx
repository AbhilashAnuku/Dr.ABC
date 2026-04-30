import { Button, cn } from '@dr-abc/ui';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Cpu,
  Network,
  Play,
  Send,
  Settings2,
  Terminal,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE } from '../../lib/config.ts';
import { PipelineGraph } from './pipeline-graph.tsx';

/**
 * DevConsoleDrawer — collapsible panel that lives at the bottom of the
 * clinic page. Doctor role: open by default. Patient: hidden.
 *
 * Tabs:
 *   1. Pipeline   — animated agent mesh, lights up agents as they fire
 *   2. Query lab  — custom prompt runner with model + temp + top-K knobs;
 *                   streams the live SSE event log
 *   3. Activity   — newest-first tail of /dev/activity (developer-gated;
 *                   degrades to "needs developer role" when 403)
 *
 * Wires directly to /orchestrate so the developer can run any prompt
 * against the real agent mesh and see exactly which agents fire, in
 * what order, with what timing.
 */

type Tab = 'pipeline' | 'querylab' | 'activity';

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

export function DevConsoleDrawer({
  defaultOpen,
  className,
}: {
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [tab, setTab] = useState<Tab>('pipeline');
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
    // Reset run state inline so this callback is genuinely self-contained
    // (avoids the exhaustive-deps trap on a closure-captured helper).
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
          // Surface the dev-tool pivots in headers so the activity sink
          // can pin the call to "querylab" rather than the chat.
          'X-Dr-Abc-Source': 'dev-console',
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
    <div
      className={cn(
        'rounded-2xl border border-purple-400/20 bg-black/50 backdrop-blur-2xl transition-all',
        open ? 'shadow-[0_0_80px_-30px_rgba(139,92,246,0.6)]' : '',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-purple-300" />
          <span className="font-syne text-sm font-semibold text-app-primary">
            Developer console
          </span>
          <span className="rounded-full border border-purple-400/30 bg-purple-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-purple-300">
            pipeline · query lab · activity
          </span>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-app-muted" />
        ) : (
          <ChevronUp className="h-4 w-4 text-app-muted" />
        )}
      </button>

      {open && (
        <div className="border-t border-purple-400/20">
          <div className="flex items-center gap-1 border-b border-app-subtle px-3 py-2">
            <TabButton current={tab} value="pipeline" onClick={setTab} icon={Network}>
              Pipeline
            </TabButton>
            <TabButton current={tab} value="querylab" onClick={setTab} icon={Cpu}>
              Query lab
            </TabButton>
            <TabButton current={tab} value="activity" onClick={setTab} icon={Activity}>
              Activity
            </TabButton>
            {pipelineMs !== null && (
              <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
                last run · {pipelineMs.toFixed(0)} ms
              </span>
            )}
          </div>

          {tab === 'pipeline' && (
            <div className="grid gap-4 p-4 lg:grid-cols-[1.6fr_1fr]">
              <PipelineGraph
                activeAgents={activeAgents}
                completedAgents={completedAgents}
                onPickAgent={setPickedAgent}
                className="rounded-xl border border-app-subtle bg-black/30"
              />
              <PipelineSidebar
                pickedAgent={pickedAgent}
                events={events}
                completedAgents={completedAgents}
              />
            </div>
          )}

          {tab === 'querylab' && (
            <QueryLab
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

          {tab === 'activity' && <ActivityTail />}
        </div>
      )}
    </div>
  );
}

function TabButton({
  current,
  value,
  onClick,
  icon: Icon,
  children,
}: {
  current: Tab;
  value: Tab;
  onClick: (v: Tab) => void;
  icon: typeof Terminal;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
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

function PipelineSidebar({
  pickedAgent,
  events,
  completedAgents,
}: {
  pickedAgent: string | null;
  events: SseEvent[];
  completedAgents: ReadonlySet<string>;
}) {
  const agentEvents = useMemo(
    () => (pickedAgent ? events.filter((e) => e.agent === pickedAgent) : events.slice(-12)),
    [pickedAgent, events],
  );
  return (
    <div className="rounded-xl border border-app-subtle bg-black/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          {pickedAgent ? `inspector · ${pickedAgent}` : `live tail · ${events.length} events`}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-bio-300">
          {completedAgents.size} done
        </span>
      </div>
      <div className="max-h-[260px] space-y-1 overflow-y-auto">
        {agentEvents.length === 0 ? (
          <p className="font-grotesk text-xs text-app-muted">
            Run a query in the Query-Lab tab — agents will light up here as they fire.
          </p>
        ) : (
          agentEvents.map((e, i) => (
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
  );
}

function QueryLab({
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
}: {
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
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1fr]">
      <div>
        <div className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-purple-300">
          <Settings2 className="h-3 w-3" />
          custom prompt
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          className="w-full rounded-lg border border-app-subtle bg-white/5 px-3 py-2 font-grotesk text-sm text-app-primary placeholder:text-app-faint focus:border-purple-400/60 focus:outline-none"
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
        <Button
          variant="primary"
          onClick={onRun}
          disabled={streaming || !prompt.trim()}
          className="mt-4 w-full rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500"
        >
          {streaming ? (
            <>
              Streaming…
              <Play className="ml-1.5 h-4 w-4 animate-pulse" />
            </>
          ) : (
            <>
              Run query <Send className="ml-1.5 h-4 w-4" />
            </>
          )}
        </Button>
      </div>

      <div>
        <div className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-blue-300">
          <Activity className="h-3 w-3" />
          SSE stream · {events.length} events
        </div>
        <div className="h-[260px] overflow-y-auto rounded-lg border border-app-subtle bg-black/40 p-3 font-mono text-[11px]">
          {events.length === 0 ? (
            <p className="font-grotesk text-xs text-app-muted">
              Click Run query — every event the orchestrator emits streams here in order.
            </p>
          ) : (
            events.map((e, i) => (
              <div
                key={`${e.type}-${e.ts}-${i}`}
                className="flex items-start gap-2 border-b border-app-subtle/40 py-1 last:border-b-0"
              >
                <span className="w-14 shrink-0 text-app-faint tabular-nums">
                  {((e.ts - (events[0]?.ts ?? e.ts)) / 1000 || 0).toFixed(2)}s
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

function ActivityTail() {
  const [entries, setEntries] = useState<
    { id: string; ts: number; action: string; status: string; latencyMs?: number; route: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let alive = true;
    let es: EventSource | null = null;
    try {
      // EventSource doesn't allow custom headers — the dev tail is
      // server-tagged as developer-required, so we surface a graceful
      // hint when 403 instead of bombing.
      es = new EventSource(`${API_BASE}/dev/activity/stream`);
      es.addEventListener('activity', (ev) => {
        if (!alive) return;
        try {
          const entry = JSON.parse((ev as MessageEvent).data);
          setEntries((p) => [entry, ...p].slice(0, 100));
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
        <Activity className="h-3 w-3" />
        live activity tail · since {new Date(startedAt.current).toLocaleTimeString()}
      </div>
      {error && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 font-grotesk text-xs text-amber-200">
          {error}
        </p>
      )}
      <div className="mt-2 max-h-[280px] space-y-1 overflow-y-auto rounded-lg border border-app-subtle bg-black/40 p-3 font-mono text-[11px]">
        {entries.length === 0 && !error && (
          <p className="font-grotesk text-xs text-app-muted">
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
