import { Button, Card } from '@dr-abc/ui';
import { Beaker, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { recordActivity } from '../../lib/activity.ts';
import { useAuth } from '../../lib/auth.tsx';

const PLAN_KEY = 'dr-abc:training-plan';

interface TrainingPlan {
  selectedAt: number;
  dataset: { id?: string; name?: string; source?: string; size?: number };
  bestAlgo?: { algo?: string; rocAuc?: number; latencyMs?: number };
}

/**
 * Reads the TrainingPlan localStorage key written by /app/lab. Surfaces
 * the chosen dataset + best algorithm so the developer can see what
 * Mörbius is queued to learn next, and pushes a `training_plan_promoted`
 * activity row when promoted to the (Stage 8) memory queue.
 */
export function TrainingPlanCard() {
  const { user } = useAuth();
  const [plan, setPlan] = useState<TrainingPlan | null>(null);
  const [promoted, setPromoted] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PLAN_KEY);
      if (raw) setPlan(JSON.parse(raw) as TrainingPlan);
    } catch {
      // ignore
    }
  }, []);

  const promote = () => {
    if (!plan || !user) return;
    recordActivity({
      role: 'developer',
      userId: user.id,
      route: '/app/console',
      action: 'training_plan_promoted',
      payload: {
        datasetId: plan.dataset.id,
        datasetName: plan.dataset.name,
        algo: plan.bestAlgo?.algo,
        rocAuc: plan.bestAlgo?.rocAuc,
      },
    });
    setPromoted(true);
    setTimeout(() => setPromoted(false), 4000);
  };

  return (
    <Card className="p-4">
      <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-app-primary">
        <Beaker className="h-4 w-4 text-quantum-400" /> Training plan
      </h3>
      {plan ? (
        <>
          <div className="rounded-md border border-app-subtle bg-white/3 p-3">
            <div className="font-display text-sm font-semibold text-app-primary">
              {plan.dataset.name ?? plan.dataset.id ?? 'Untitled dataset'}
            </div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
              {plan.dataset.source ?? '—'} · {plan.dataset.size ?? '?'} rows · selected{' '}
              {new Date(plan.selectedAt).toLocaleString()}
            </div>
            {plan.bestAlgo && (
              <div className="mt-2 flex items-center gap-3 font-mono text-[11px] text-app-secondary">
                <span>
                  best algo: <span className="text-app-primary">{plan.bestAlgo.algo ?? '—'}</span>
                </span>
                <span>
                  AUC:{' '}
                  <span className="text-bio-300">{plan.bestAlgo.rocAuc?.toFixed(3) ?? '—'}</span>
                </span>
                <span>{plan.bestAlgo.latencyMs ?? '—'}ms</span>
              </div>
            )}
          </div>
          <Button
            variant="primary"
            onClick={promote}
            disabled={promoted}
            className="mt-3 w-full text-xs"
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            {promoted ? 'queued · Stage 8 will pick this up' : 'Push to memory queue'}
          </Button>
        </>
      ) : (
        <p className="font-sans text-xs text-app-muted">
          No training plan selected. Open{' '}
          <span className="font-mono text-app-primary">/app/lab</span>, pick a dataset, run the
          comparator, then click "Pick this for Mörbius training".
        </p>
      )}
    </Card>
  );
}
