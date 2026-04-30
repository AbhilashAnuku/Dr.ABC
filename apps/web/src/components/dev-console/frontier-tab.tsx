import { Card, cn } from '@dr-abc/ui';
import {
  AlertTriangle,
  Atom,
  Compass,
  FlaskConical,
  Lightbulb,
  Send,
  Sparkles,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { API_BASE } from '../../lib/config.ts';

/**
 * FrontierTab — Discovery / Frontier-thinker mode for the dev console.
 *
 * Positions Mörbius as a forward-looking reasoner: it predicts the
 * case diagnosis and suggests meds, and answers open-ended discovery
 * prompts (e.g. "how can I cure cancer X") using its medical knowledge.
 *
 * Open-ended research question → structured discovery output:
 *   - Hypotheses (with boldness tags)
 *   - Adjacent fields that might unlock progress
 *   - Open questions where we genuinely don't know yet
 *   - Concrete experiments to run
 *   - Existing evidence anchors
 *   - Risks
 *
 * Powered by POST /research/frontier (cascade NVIDIA → Anthropic → Ollama;
 * Llama 3.3 70b Instruct via NVIDIA NIM by default). Grounded with
 * PubMed E-utilities retrieval — top 4 abstracts on the topic seed
 * the prompt so hypotheses cite real literature, not training-data
 * hallucinations.
 *
 * NOT a clinical-decision endpoint. Every reply ends with a research-
 * grade disclaimer; the operator is a researcher, not a patient.
 */

interface FrontierResult {
  topic?: string;
  summary?: string;
  hypotheses?: Array<{ claim?: string; rationale?: string; boldness?: string }>;
  adjacentFields?: string[];
  openQuestions?: string[];
  experimentsToTry?: Array<{ design?: string; endpoint?: string; feasibility?: string }>;
  existingEvidence?: Array<{ claim?: string; source?: string }>;
  risks?: string[];
  disclaimer?: string;
}

interface FrontierResponse {
  ok: boolean;
  modelUsed?: string;
  retrievalUsed?: boolean;
  result?: FrontierResult | null;
  raw?: string | null;
  error?: string;
  attempts?: string[];
}

const SAMPLE_QUESTIONS = [
  'How could we cure pancreatic cancer? What are the most overlooked angles?',
  "What's the best path to early Alzheimer's detection from blood biomarkers alone?",
  'Could the gut microbiome reset the trajectory of treatment-resistant depression?',
  'Where could quantum computing actually move the needle in medicine in five years?',
  'What is the most under-investigated cause of chronic fatigue syndrome?',
];

export function FrontierTab() {
  const [question, setQuestion] = useState(SAMPLE_QUESTIONS[0] ?? '');
  const [resp, setResp] = useState<FrontierResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (loading || !question.trim()) return;
    setLoading(true);
    setError(null);
    setResp(null);
    try {
      const r = await fetch(`${API_BASE}/research/frontier`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: question.trim() }),
      });
      const j = (await r.json()) as FrontierResponse;
      setResp(j);
      if (!j.ok && j.error) setError(j.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setLoading(false);
    }
  };

  const r = resp?.result;

  return (
    <div className="space-y-5 p-4 sm:p-5">
      {/* Hero */}
      <div className="rounded-2xl border border-purple-400/30 bg-gradient-to-br from-purple-500/10 via-quantum-500/10 to-bio-500/10 p-5">
        <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
          <Compass className="h-3 w-3" /> · frontier · discovery mode
        </div>
        <h3 className="mt-2 font-display text-2xl font-bold text-app-primary sm:text-3xl">
          Think like a researcher.
        </h3>
        <p className="mt-2 max-w-2xl font-sans text-sm text-app-muted">
          Ask Mörbius an open-ended research question — disease, biomarker, treatment angle. Mörbius
          pulls fresh PubMed evidence, then returns testable hypotheses, adjacent disciplines that
          might unlock progress, concrete experiments, and the open questions worth asking. Bold
          hypotheses are tagged so you see what's frontier vs what's safe.
        </p>

        <form onSubmit={submit} className="mt-4 flex flex-col gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            placeholder="how could we cure …"
            className="min-h-[3.5rem] rounded-lg border border-app-subtle bg-black/30 px-3 py-2 font-sans text-sm text-app-primary placeholder:text-app-faint focus:border-purple-400/60 focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="inline-flex items-center gap-2 rounded-lg border border-purple-400/40 bg-purple-500/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-purple-200 transition hover:bg-purple-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Sparkles className="h-3.5 w-3.5 animate-pulse" /> reasoning · pulling pubmed…
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" /> ask the frontier
                </>
              )}
            </button>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
              cascade · nvidia llama 3.3 70b → anthropic → ollama
            </span>
          </div>
        </form>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {SAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuestion(q)}
              className="rounded-full border border-app-subtle bg-white/5 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-app-muted transition hover:border-purple-400/40 hover:bg-purple-500/10 hover:text-purple-200"
            >
              {q.length > 64 ? `${q.slice(0, 60)}…` : q}
            </button>
          ))}
        </div>
      </div>

      {/* Result */}
      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 font-mono text-xs text-rose-200">
          {error}
        </div>
      )}

      {resp?.modelUsed && (
        <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
          <span>
            backed by · <span className="text-bio-300">{resp.modelUsed}</span>
          </span>
          {resp.retrievalUsed && (
            <span className="rounded-full border border-bio-400/40 bg-bio-500/10 px-2 py-0.5 text-bio-200">
              ✓ pubmed-grounded
            </span>
          )}
        </div>
      )}

      {r && (
        <div className="grid gap-4 lg:grid-cols-2">
          {r.summary && (
            <Card className="lg:col-span-2 p-5">
              <div className="mb-2 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
                <Atom className="h-3 w-3" /> · framing
              </div>
              <p className="font-display text-lg leading-relaxed text-app-primary">{r.summary}</p>
              {r.topic && (
                <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
                  topic · {r.topic}
                </p>
              )}
            </Card>
          )}

          {r.hypotheses && r.hypotheses.length > 0 && (
            <Card className="p-5">
              <div className="mb-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-purple-300">
                <Lightbulb className="h-3 w-3" /> · hypotheses ({r.hypotheses.length})
              </div>
              <ul className="space-y-3">
                {r.hypotheses.map((h, i) => (
                  <li
                    key={`hyp-${i}-${h.claim?.slice(0, 16) ?? ''}`}
                    className="rounded-lg border border-app-subtle bg-white/3 p-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-sans text-sm font-medium text-app-primary">{h.claim}</p>
                      <BoldnessChip tone={h.boldness} />
                    </div>
                    {h.rationale && (
                      <p className="mt-1 font-sans text-xs text-app-muted">{h.rationale}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {r.experimentsToTry && r.experimentsToTry.length > 0 && (
            <Card className="p-5">
              <div className="mb-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-bio-300">
                <FlaskConical className="h-3 w-3" /> · experiments to run
              </div>
              <ul className="space-y-3">
                {r.experimentsToTry.map((x, i) => (
                  <li
                    key={`exp-${i}-${x.design?.slice(0, 16) ?? ''}`}
                    className="rounded-lg border border-app-subtle bg-white/3 p-3"
                  >
                    <p className="font-sans text-sm font-medium text-app-primary">{x.design}</p>
                    {x.endpoint && (
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-app-muted">
                        endpoint · {x.endpoint}
                      </p>
                    )}
                    <FeasibilityChip tone={x.feasibility} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {r.adjacentFields && r.adjacentFields.length > 0 && (
            <Card className="p-5">
              <div className="mb-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
                <Compass className="h-3 w-3" /> · adjacent fields
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.adjacentFields.map((f, i) => (
                  <span
                    key={`af-${i}-${f.slice(0, 12)}`}
                    className="inline-flex items-center rounded-full border border-quantum-400/30 bg-quantum-500/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-quantum-200"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </Card>
          )}

          {r.openQuestions && r.openQuestions.length > 0 && (
            <Card className="p-5">
              <div className="mb-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-amber-300">
                <Lightbulb className="h-3 w-3" /> · open questions
              </div>
              <ul className="space-y-2 font-sans text-sm text-app-secondary">
                {r.openQuestions.map((q, i) => (
                  <li
                    key={`oq-${i}-${q.slice(0, 16)}`}
                    className="border-app-subtle border-l-2 pl-3"
                  >
                    {q}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {r.existingEvidence && r.existingEvidence.length > 0 && (
            <Card className="p-5 lg:col-span-2">
              <div className="mb-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-bio-300">
                ✓ · existing evidence anchors
              </div>
              <ul className="space-y-2">
                {r.existingEvidence.map((e, i) => (
                  <li
                    key={`ev-${i}-${e.claim?.slice(0, 16) ?? ''}`}
                    className="rounded-lg border border-app-subtle bg-white/3 p-3"
                  >
                    <p className="font-sans text-sm text-app-primary">{e.claim}</p>
                    {e.source && (
                      <p className="mt-1 font-mono text-[10px] text-app-faint">{e.source}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {r.risks && r.risks.length > 0 && (
            <Card className="p-5 lg:col-span-2">
              <div className="mb-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-rose-300">
                <AlertTriangle className="h-3 w-3" /> · risks of this line
              </div>
              <ul className="space-y-1.5 font-sans text-sm text-app-secondary">
                {r.risks.map((risk, i) => (
                  <li
                    key={`risk-${i}-${risk.slice(0, 16)}`}
                    className="border-rose-500/40 border-l-2 pl-3"
                  >
                    {risk}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {r.disclaimer && (
            <Card className="lg:col-span-2 border-amber-400/40 bg-amber-500/5 p-4">
              <p className="font-sans text-xs text-amber-200">{r.disclaimer}</p>
            </Card>
          )}
        </div>
      )}

      {resp && !r && resp.raw && (
        <Card className="p-5">
          <div className="mb-2 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-amber-300">
            ⚠ raw output · structured parse failed
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-app-subtle bg-black/30 p-3 font-mono text-[11px] text-app-secondary">
            {resp.raw}
          </pre>
        </Card>
      )}
    </div>
  );
}

function BoldnessChip({ tone }: { tone?: string }) {
  if (!tone) return null;
  const t = tone.toLowerCase();
  const cls =
    t === 'high'
      ? 'border-rose-400/40 bg-rose-500/10 text-rose-200'
      : t === 'medium'
        ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
        : 'border-bio-400/40 bg-bio-500/10 text-bio-200';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]',
        cls,
      )}
    >
      {t}
    </span>
  );
}

function FeasibilityChip({ tone }: { tone?: string }) {
  if (!tone) return null;
  const t = tone.toLowerCase();
  const cls =
    t === 'low'
      ? 'border-rose-400/40 bg-rose-500/10 text-rose-200'
      : t === 'medium'
        ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
        : 'border-bio-400/40 bg-bio-500/10 text-bio-200';
  return (
    <span
      className={cn(
        'mt-2 inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]',
        cls,
      )}
    >
      feasibility · {t}
    </span>
  );
}
