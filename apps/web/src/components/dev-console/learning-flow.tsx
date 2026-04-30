import { Card, PulseDot, cn } from '@dr-abc/ui';
import { motion } from 'framer-motion';
import {
  ArrowDown,
  Brain,
  Database,
  GitBranch,
  Loader2,
  Play,
  Sparkles,
  Stethoscope,
  Target,
  TrendingUp,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth.tsx';
import { API_BASE } from '../../lib/config.ts';
import { listMemory } from '../../lib/morbius-memory.ts';
import { type Corpus, buildCorpus } from '../../lib/training-corpus.ts';

/**
 * LearningFlow — visualises Mörbius's continuous-learning loop in real
 * time: exactly what is being learned, where the data comes from, and
 * what the system would change next.
 *
 * Five stages:
 *
 *   1. Memory          — every signed-off consult lands in IndexedDB
 *   2. Corpus          — stratified sampler over memory + activity sink
 *   3. Tuner           — picks worst-exemplar, drafts a new prompt prefix
 *   4. Proposals       — pending diff vs the live agent prompt
 *   5. Calibrator      — adjusts validator/safety/privacy thresholds from
 *                        observed pass/fail rates in the activity sink
 *
 * Each stage shows the live count + "active" pulse. The flow renders
 * top→bottom with animated arrows lighting up when each stage has data.
 *
 * Mörbius's memory becomes Mörbius's training data, and every learned
 * change can be approved before it ships.
 */

interface HealthSnapshot {
  gauntletThresholds?: {
    validator: number;
    safety: number;
    privacy: number;
  };
  diagnosticBackend?: string;
}

interface CalibrateResult {
  ok?: boolean;
  thresholds?: HealthSnapshot['gauntletThresholds'];
  notes?: string[];
}

export function LearningFlow() {
  const { user } = useAuth();
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [memorySize, setMemorySize] = useState<number | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrateResult, setCalibrateResult] = useState<CalibrateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const [c, mem, h] = await Promise.all([
        buildCorpus(user.id),
        listMemory(user.id, 500),
        fetch(`${API_BASE}/health`).then((r) => r.json() as Promise<HealthSnapshot>),
      ]);
      setCorpus(c);
      setMemorySize(mem.length);
      setHealth(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'refresh failed');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const triggerCalibration = async () => {
    setCalibrating(true);
    setCalibrateResult(null);
    try {
      const r = await fetch(`${API_BASE}/dev/calibrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dr-Abc-Role': 'developer' },
        body: JSON.stringify({}),
      });
      const j = (await r.json().catch(() => ({}))) as CalibrateResult;
      setCalibrateResult(j);
      void refresh();
    } catch (e) {
      setCalibrateResult({
        ok: false,
        notes: [e instanceof Error ? e.message : 'calibrate failed'],
      });
    } finally {
      setCalibrating(false);
    }
  };

  const corpusBySpecialty = useMemo(() => {
    if (!corpus) return [];
    return Object.entries(corpus.stats.perSpecialty)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8);
  }, [corpus]);

  const corpusByEsi = useMemo(() => {
    if (!corpus) return [];
    return Object.entries(corpus.stats.perEsiBucket).sort(([a], [b]) => Number(a) - Number(b));
  }, [corpus]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
              <Brain className="h-3 w-3" /> · continuous learning · live view
            </div>
            <h2 className="mt-1 font-display text-xl font-bold text-app-primary">
              How Mörbius gets better, observably.
            </h2>
            <p className="mt-1 max-w-3xl font-sans text-xs text-app-muted">
              Every signed-off consult enters memory. Memory becomes a stratified corpus. The corpus
              drives a deterministic prompt-tuner. Proposed prompt diffs queue here for the operator
              to approve. Separately, the calibrator nudges the validator / safety / privacy
              thresholds from observed pass/fail rates in the activity sink.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || !user?.id}
            className="inline-flex items-center gap-1.5 rounded-md border border-quantum-400/40 bg-quantum-500/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-quantum-200 transition hover:bg-quantum-500/25 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            refresh
          </button>
        </div>
      </Card>

      {error && (
        <Card className="border-rose-500/40 p-3">
          <p className="font-mono text-[11px] text-rose-300">refresh failed: {error}</p>
        </Card>
      )}

      <Card className="p-5">
        <Stage
          step={1}
          title="Memory"
          tone="quantum"
          icon={Database}
          active={memorySize !== null && memorySize > 0}
          stat={memorySize !== null ? `${memorySize} entries` : '…'}
          detail="per-user IndexedDB · TF-cosine recall · seeded with 15 demo cases"
        />
        <FlowArrow active={memorySize !== null && memorySize > 0} />
        <Stage
          step={2}
          title="Corpus"
          tone="bio"
          icon={Sparkles}
          active={corpus !== null && corpus.stats.totalExemplars > 0}
          stat={corpus ? `${corpus.stats.totalExemplars} stratified exemplars` : '…'}
          detail="balanced over (specialty × ICD chapter × ESI tier) · bounded per bucket"
        >
          {corpus && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
                  by specialty
                </div>
                <div className="space-y-1">
                  {corpusBySpecialty.map(([spec, n]) => (
                    <Bar key={spec} label={spec} value={n} max={corpus.stats.totalExemplars} />
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
                  by ESI tier (1=immediate · 5=routine)
                </div>
                <div className="space-y-1">
                  {corpusByEsi.map(([tier, n]) => (
                    <Bar
                      key={tier}
                      label={`tier ${tier}`}
                      value={n}
                      max={corpus.stats.totalExemplars}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </Stage>
        <FlowArrow active={corpus !== null && corpus.stats.totalExemplars > 0} />
        <Stage
          step={3}
          title="Tuner"
          tone="amber"
          icon={Stethoscope}
          active={(corpus?.stats.totalExemplars ?? 0) > 5}
          stat={
            (corpus?.stats.totalExemplars ?? 0) > 5
              ? 'ready · run `bun run morbius:tune`'
              : 'needs ≥ 6 exemplars'
          }
          detail="picks the worst-performing exemplar per specialty → drafts a refined prompt prefix → emits a TuneProposal for review"
        />
        <FlowArrow active={(corpus?.stats.totalExemplars ?? 0) > 5} />
        <Stage
          step={4}
          title="Proposals"
          tone="quantum"
          icon={GitBranch}
          active={false}
          stat="0 pending · approve from CLI"
          detail="prompt diffs land in `docs/status/tune-YYYY-MM-DD.json` · operator-approved before any specialist prompt changes"
        />
        <FlowArrow active />
        <Stage
          step={5}
          title="Calibrator"
          tone="bio"
          icon={Target}
          active={!!health?.gauntletThresholds}
          stat={
            health?.gauntletThresholds
              ? `validator ${health.gauntletThresholds.validator.toFixed(2)} · safety ${health.gauntletThresholds.safety.toFixed(2)} · privacy ${health.gauntletThresholds.privacy.toFixed(2)}`
              : '…'
          }
          detail="reads activity sink · adjusts gauntlet thresholds ± 0.05/cycle · bounded [0.5, 0.95]"
        >
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void triggerCalibration()}
              disabled={calibrating}
              className="inline-flex items-center gap-1.5 rounded-md border border-bio-500/40 bg-bio-500/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-bio-200 transition hover:bg-bio-500/25 disabled:opacity-50"
            >
              {calibrating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <TrendingUp className="h-3 w-3" />
              )}
              run one calibration cycle
            </button>
            {calibrateResult && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em]',
                  calibrateResult.ok === false ? 'text-rose-300' : 'text-bio-300',
                )}
              >
                <PulseDot active size="xs" tone={calibrateResult.ok === false ? 'rose' : 'bio'} />
                {calibrateResult.ok === false
                  ? `failed${calibrateResult.notes?.[0] ? ` · ${calibrateResult.notes[0]}` : ''}`
                  : 'cycle ran · thresholds updated'}
              </span>
            )}
          </div>
        </Stage>
      </Card>

      <Card className="p-4">
        <div className="mb-2 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-app-faint">
          <Brain className="h-3 w-3" /> what gets learned
        </div>
        <ul className="space-y-2 font-sans text-xs leading-relaxed text-app-muted">
          <li>
            <span className="font-mono text-quantum-300">prompt prefixes</span> per specialist agent
            — refined from worst-performing exemplars in that specialty bucket.
          </li>
          <li>
            <span className="font-mono text-quantum-300">gauntlet thresholds</span> for validator /
            safety / privacy — auto-adjusted from observed pass-fail rates so the gates stay honest,
            not stuck at the package defaults.
          </li>
          <li>
            <span className="font-mono text-quantum-300">memory recall scoring</span> — TF-cosine
            embedding model is per-user, so the second consult on the same patient already pulls the
            first consult's context into the prompt window.
          </li>
          <li>
            <span className="font-mono text-quantum-300">activity sink rollups</span> — per-agent
            latency / confidence / failure-mode aggregates feed both the calibrator and the dev
            console's Inventory tab; the loop closes without anyone re-typing data.
          </li>
        </ul>
      </Card>
    </div>
  );
}

interface StageProps {
  step: number;
  title: string;
  tone: 'quantum' | 'bio' | 'amber';
  icon: typeof Database;
  active: boolean;
  stat: string;
  detail: string;
  children?: React.ReactNode;
}

function Stage({ step, title, tone, icon: Icon, active, stat, detail, children }: StageProps) {
  const ringTone =
    tone === 'quantum'
      ? 'border-quantum-400/40'
      : tone === 'bio'
        ? 'border-bio-500/40'
        : 'border-amber-500/40';
  const chipTone =
    tone === 'quantum'
      ? 'bg-quantum-500/15 text-quantum-300'
      : tone === 'bio'
        ? 'bg-bio-500/15 text-bio-300'
        : 'bg-amber-500/15 text-amber-300';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: step * 0.05 }}
      className={cn('rounded-xl border bg-white/2 p-4 transition', ringTone)}
    >
      <div className="flex items-start gap-3">
        <div className={cn('rounded-lg border p-2', ringTone, 'bg-black/30')}>
          <Icon className="h-4 w-4 text-app-secondary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-app-faint">
                step {step}
              </span>
              <h3 className="mt-0.5 inline-flex items-center gap-2 font-display text-base font-semibold text-app-primary">
                {title}
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em]',
                    chipTone,
                  )}
                >
                  {stat}
                </span>
              </h3>
            </div>
            <PulseDot active={active} size="xs" tone={tone === 'amber' ? 'amber' : tone} />
          </div>
          <p className="mt-1 font-sans text-xs text-app-muted">{detail}</p>
          {children}
        </div>
      </div>
    </motion.div>
  );
}

function FlowArrow({ active }: { active: boolean }) {
  return (
    <div className="my-2 flex justify-center">
      <ArrowDown
        className={cn(
          'h-5 w-5 transition-colors',
          active ? 'text-bio-400' : 'text-app-faint opacity-50',
        )}
      />
    </div>
  );
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.max(4, (value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-app-muted">
        {label}
      </span>
      <div className="relative h-1.5 flex-1 rounded-full bg-white/5">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5 }}
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-quantum-500 to-bio-400"
        />
      </div>
      <span className="w-6 text-right font-mono text-[10px] tabular-nums text-app-secondary">
        {value}
      </span>
    </div>
  );
}
