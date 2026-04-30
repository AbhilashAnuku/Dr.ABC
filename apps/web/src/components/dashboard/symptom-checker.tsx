import { Card, cn } from '@dr-abc/ui';
import { ArrowRight, Brain, ChevronRight, Sparkles, Zap } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'wouter';

/**
 * SymptomCheckerCard — patient-facing quickstart on the dashboard.
 *
 * Competitor benchmark: Ada Health, Buoy, K Health symptom triage.
 * Their flow is "tap a body region → answer 5 questions → get an
 * urgency score". Mörbius's version is one click shorter: pick a
 * common pattern, optionally drop in a one-line detail, then get
 * routed straight into the live consult flow with the prompt
 * pre-stuffed. The agent mesh handles the actual triage + ESI score.
 *
 * Stored in `sessionStorage` so the consult page picks it up on next
 * mount (the existing `dr-abc:pending-consult` channel).
 */

interface QuickPattern {
  id: string;
  glyph: string;
  label: string;
  prompt: string;
  urgency: 'low' | 'medium' | 'high' | 'emergency';
}

const PATTERNS: QuickPattern[] = [
  {
    id: 'chest-pain',
    glyph: '♥',
    label: 'Chest pain',
    prompt: 'Crushing chest pain radiating to the left arm, started 30 minutes ago.',
    urgency: 'emergency',
  },
  {
    id: 'headache',
    glyph: '🧠',
    label: 'Headache',
    prompt: 'Severe headache for the last three days, worse in the morning.',
    urgency: 'medium',
  },
  {
    id: 'fever',
    glyph: '🌡',
    label: 'Fever + cough',
    prompt: 'Fever 38.6°C with productive cough for two days.',
    urgency: 'medium',
  },
  {
    id: 'rash',
    glyph: '⊞',
    label: 'Skin rash',
    prompt: 'Itchy red rash on both forearms, started yesterday.',
    urgency: 'low',
  },
  {
    id: 'breath',
    glyph: '🫁',
    label: 'Shortness of breath',
    prompt: 'Sudden shortness of breath at rest with mild chest tightness.',
    urgency: 'high',
  },
  {
    id: 'gut',
    glyph: '⚖',
    label: 'Stomach pain',
    prompt: 'Right lower quadrant abdominal pain since yesterday, worse on movement.',
    urgency: 'high',
  },
];

const URGENCY_TONE: Record<QuickPattern['urgency'], { ring: string; chip: string; label: string }> =
  {
    low: { ring: 'border-bio-500/40', chip: 'bg-bio-500/15 text-bio-300', label: 'low' },
    medium: {
      ring: 'border-amber-500/40',
      chip: 'bg-amber-500/15 text-amber-300',
      label: 'medium',
    },
    high: { ring: 'border-rose-500/40', chip: 'bg-rose-500/15 text-rose-300', label: 'high' },
    emergency: {
      ring: 'border-rose-500/60 shadow-[0_0_30px_-15px_rgba(244,63,94,0.7)]',
      chip: 'bg-rose-500/25 text-rose-200',
      label: 'emergency',
    },
  };

export function SymptomCheckerCard() {
  const [, setLocation] = useLocation();
  const [extra, setExtra] = useState('');

  const launchWith = (prompt: string) => {
    const final = extra.trim() ? `${prompt} ${extra.trim()}` : prompt;
    window.sessionStorage.setItem('dr-abc:pending-consult', final);
    setLocation('/app/consult');
  };

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
            <Brain className="h-3 w-3" /> · symptom checker · 1-click triage
          </div>
          <h2 className="mt-1 font-display text-xl font-bold text-app-primary">
            Tell Mörbius what's wrong.
          </h2>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          {PATTERNS.length} common patterns · ESI scored on submit
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {PATTERNS.map((p) => {
          const t = URGENCY_TONE[p.urgency];
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => launchWith(p.prompt)}
              className={cn(
                'group flex items-start gap-3 rounded-xl border bg-white/2 p-3 text-left transition hover:-translate-y-0.5 hover:bg-white/[0.05]',
                t.ring,
              )}
            >
              <span className="text-2xl leading-none">{p.glyph}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-semibold text-app-primary">
                    {p.label}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em]',
                      t.chip,
                    )}
                  >
                    {t.label}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 font-sans text-xs leading-snug text-app-muted group-hover:text-app-secondary">
                  {p.prompt}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-app-faint transition group-hover:translate-x-0.5 group-hover:text-purple-300" />
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-app-subtle bg-black/20 p-2.5">
        <Sparkles className="h-4 w-4 text-purple-300" />
        <input
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="Optional · add a one-line detail before launching the consult…"
          className="flex-1 bg-transparent font-sans text-sm text-app-primary placeholder:text-app-faint focus:outline-none"
        />
        <button
          type="button"
          disabled={!extra.trim()}
          onClick={() => launchWith(extra.trim())}
          className="inline-flex items-center gap-1 rounded-md border border-purple-400/40 bg-purple-500/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-purple-200 transition hover:bg-purple-500/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Zap className="h-3 w-3" /> open consult
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
        Patterns are conversation starters · the triage agent computes the real ESI from your full
        story. Always call emergency services if you're truly in danger.
      </p>
    </Card>
  );
}
