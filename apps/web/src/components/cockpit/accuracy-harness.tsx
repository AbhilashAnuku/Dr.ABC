import { Button, Card, cn } from '@dr-abc/ui';
import { Loader2, Play, Target } from 'lucide-react';
import { useEffect, useState } from 'react';
import { recordActivity } from '../../lib/activity.ts';
import { useAuth } from '../../lib/auth.tsx';

const RUNS_KEY = 'dr-abc:accuracy-runs';

interface CorpusItem {
  id: string;
  query: string;
  expect: string[]; // tokens we expect to see in the diagnostic / pipeline summary
}

interface RunResult {
  id: string;
  ranAt: number;
  hits: number;
  total: number;
  scoreAvg: number;
  perItem: { id: string; matched: boolean; tokens: string[] }[];
}

const CORPUS: CorpusItem[] = [
  {
    id: 'mi',
    query: 'crushing chest pain radiating to left arm with sweating and nausea',
    expect: ['myocardial', 'mi', 'cardio', 'troponin', 'stemi'],
  },
  {
    id: 'sah',
    query: 'sudden worst headache of my life with neck stiffness',
    expect: ['subarachnoid', 'haemorrhage', 'hemorrhage', 'sah', 'meningitis'],
  },
  {
    id: 'asthma',
    query: 'wheezing and shortness of breath at night for 3 weeks',
    expect: ['asthma', 'bronchospasm', 'salbutamol', 'inhaler'],
  },
  {
    id: 'dm2',
    query: 'frequent urination thirst weight loss fatigue 6 weeks',
    expect: ['diabetes', 'hyperglyc', 'metformin', 'hba1c', 't2dm'],
  },
  {
    id: 'covid',
    query: 'fever sore throat dry cough loss of smell after travel',
    expect: ['covid', 'sars', 'isolation', 'pcr', 'viral'],
  },
  {
    id: 'depression',
    query: 'low mood anhedonia poor sleep 8 weeks no energy',
    expect: ['depression', 'mood', 'ssri', 'cbt', 'phq'],
  },
  {
    id: 'gerd',
    query: 'burning chest after meals worse lying down for months',
    expect: ['gerd', 'reflux', 'ppi', 'omeprazole', 'antacid'],
  },
  {
    id: 'migraine',
    query: 'unilateral throbbing headache photophobia nausea 1 day',
    expect: ['migraine', 'triptan', 'sumatriptan', 'aura'],
  },
  {
    id: 'tb',
    query: 'productive cough night sweats weight loss 6 weeks',
    expect: ['tuberculosis', 'tb', 'mycobact', 'rifam', 'isoniaz'],
  },
  {
    id: 'aki',
    query: 'oliguria after vomiting and dehydration creatinine rising',
    expect: ['aki', 'kidney', 'renal', 'hydration', 'dialysis'],
  },
];

/**
 * Replays a fixed corpus of 10 consults through /api/orchestrate, scores
 * each response against expected tokens, and persists runs to localStorage
 * so the developer can chart drift over time. Each run produces a
 * `accuracy.run.completed` activity entry the cockpit's left column
 * picks up live.
 */
export function AccuracyHarness() {
  const { user } = useAuth();
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<RunResult[]>([]);
  const [latest, setLatest] = useState<RunResult | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RUNS_KEY);
      if (raw) setRuns(JSON.parse(raw) as RunResult[]);
    } catch {
      // ignore
    }
  }, []);

  const run = async () => {
    if (!user) return;
    setRunning(true);
    const t0 = performance.now();
    const perItem: RunResult['perItem'] = [];
    let hits = 0;
    let totalScore = 0;
    for (const item of CORPUS) {
      try {
        const text = await orchestrateText(item.query);
        const lower = text.toLowerCase();
        const tokens = item.expect.filter((t) => lower.includes(t));
        const matched = tokens.length > 0;
        if (matched) hits++;
        totalScore += tokens.length / item.expect.length;
        perItem.push({ id: item.id, matched, tokens });
      } catch {
        perItem.push({ id: item.id, matched: false, tokens: [] });
      }
    }
    const result: RunResult = {
      id: `run_${Date.now()}`,
      ranAt: Date.now(),
      hits,
      total: CORPUS.length,
      scoreAvg: totalScore / CORPUS.length,
      perItem,
    };
    const next = [result, ...runs].slice(0, 20);
    setRuns(next);
    setLatest(result);
    window.localStorage.setItem(RUNS_KEY, JSON.stringify(next));
    recordActivity({
      role: 'developer',
      userId: user.id,
      route: '/app/console',
      action: 'accuracy.run.completed',
      payload: {
        hits: result.hits,
        total: result.total,
        scoreAvg: Number(result.scoreAvg.toFixed(3)),
      },
      latencyMs: Math.round(performance.now() - t0),
    });
    setRunning(false);
  };

  const prev = runs[1];

  return (
    <Card className="p-4">
      <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-app-primary">
        <Target className="h-4 w-4 text-quantum-400" /> Accuracy harness
      </h3>
      <p className="mb-3 font-sans text-xs text-app-muted">
        Replays a fixed 10-case corpus through the orchestrator, scores each against expected
        clinical tokens. Use to detect drift after a backend / model swap.
      </p>
      <Button variant="primary" onClick={run} disabled={running} className="w-full text-xs">
        {running ? (
          <>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> running 10 consults…
          </>
        ) : (
          <>
            <Play className="mr-1.5 h-3.5 w-3.5" /> Run accuracy
          </>
        )}
      </Button>

      {latest && (
        <div className="mt-3 rounded-md border border-app-subtle bg-white/3 p-3">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-base font-semibold text-app-primary">
              {latest.hits}/{latest.total} hits · score {(latest.scoreAvg * 100).toFixed(0)}%
            </span>
            {prev && (
              <span
                className={cn(
                  'font-mono text-[11px]',
                  latest.scoreAvg > prev.scoreAvg
                    ? 'text-bio-300'
                    : latest.scoreAvg < prev.scoreAvg
                      ? 'text-rose-300'
                      : 'text-app-muted',
                )}
              >
                Δ {((latest.scoreAvg - prev.scoreAvg) * 100).toFixed(1)}pt vs last
              </span>
            )}
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-[10px]">
            {latest.perItem.map((p) => (
              <li
                key={p.id}
                className={cn(
                  'rounded-sm px-2 py-0.5',
                  p.matched ? 'bg-bio-500/10 text-bio-300' : 'bg-rose-500/10 text-rose-300',
                )}
              >
                {p.matched ? '✓' : '✗'} {p.id} · {p.tokens.length}
              </li>
            ))}
          </ul>
        </div>
      )}

      {runs.length > 1 && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
          {runs.length} runs persisted · clear via DevTools → Application
        </p>
      )}
    </Card>
  );
}

/**
 * Fires one /api/orchestrate call and concatenates every agent.token /
 * agent.completed event body into one string for token-match scoring.
 */
async function orchestrateText(query: string): Promise<string> {
  const res = await fetch('/api/orchestrate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dr-abc-role': 'developer',
    },
    body: JSON.stringify({ text: query }),
  });
  if (!res.ok || !res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let combined = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (;;) {
      const nl = buf.indexOf('\n\n');
      if (nl === -1) break;
      const frame = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      try {
        const obj = JSON.parse(dataLine.slice(5).trim()) as Record<string, unknown>;
        for (const v of Object.values(obj)) {
          if (typeof v === 'string') combined += `\n${v}`;
        }
      } catch {
        // ignore malformed frame
      }
    }
  }
  return combined;
}
