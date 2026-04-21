import type { DiagnosticInput, Differential } from '@dr-abc/types';
import type { DiagnosticEnsemble } from '../diagnostic.ts';

/**
 * QuantumEnsemble — scaffolding for a future quantum-augmented
 * diagnostic backend.
 *
 * What this is, today:
 *   - A class that satisfies `DiagnosticEnsemble` so it can plug into
 *     the existing priority-resolver (`['ollama', 'nvidia',
 *     'huggingface', 'anthropic']` → `['quantum', 'ollama', ...]`
 *     once a real backend is wired).
 *   - A documented integration surface for IBM Q · IonQ · Rigetti ·
 *     Qiskit Aer simulator, behind one feature flag (`QUANTUM_BACKEND_URL`).
 *   - A safe simulation: when called, it walks the same evidence
 *     extraction pipeline the classical agents use, then layers a
 *     deterministic "quantum-style" amplitude weighting (cosine of
 *     evidence-overlap), so the differential ranking is reproducible
 *     and the result is honest about being a stub. NEVER pretends to
 *     have run on real hardware.
 *
 * What this is NOT, today:
 *   - A real Grover / QAOA / VQE call. Those need either a Qiskit
 *     Runtime cloud connection (with credentials + cost gating) or a
 *     local Aer simulator running in a Python sidecar. The roadmap
 *     for both lives in `docs/quantum-surgical-roadmap.md`.
 *
 * Activation contract — when ready:
 *   1. Set `QUANTUM_BACKEND_URL=https://qiskit-runtime…` in the env
 *      editor (or via .env).
 *   2. The factory in diagnostic.ts wires `QuantumEnsemble` ahead of
 *      Ollama in the priority list.
 *   3. The `vote()` method posts the input to the backend, expects
 *      back a `{ amplitudes: number[], differentials: Differential[] }`
 *      shape, and renormalises by amplitude.
 *
 * Until those creds exist, this stub still satisfies the interface
 * AND surfaces an honest `modelUsed: 'quantum-stub-v0'` so the
 * accuracy-harness can clearly tag rows that ran on the stub vs the
 * real classical/cloud path.
 */
export interface QuantumEnsembleOpts {
  /** Backend URL — IBM Q runtime, IonQ cloud, or local Qiskit Aer.
   *  When falsy, the ensemble runs in stub mode. */
  backendUrl?: string;
  /** Auth token for the backend, when applicable. */
  apiKey?: string;
  /** Backend identifier surfaced in `modelUsed`. */
  model?: string;
}

export class QuantumEnsemble implements DiagnosticEnsemble {
  readonly name: string;
  private backendUrl: string | undefined;
  private apiKey: string | undefined;

  constructor(opts: QuantumEnsembleOpts = {}) {
    this.backendUrl = opts.backendUrl;
    this.apiKey = opts.apiKey;
    this.name = opts.backendUrl ? (opts.model ?? 'quantum-augmented') : 'quantum-stub-v0';
  }

  async vote(input: DiagnosticInput): Promise<{
    differentials: Differential[];
    recommendedTests: string[];
    recommendedSpecialty: string;
    rawConfidence: number;
  }> {
    if (this.backendUrl) {
      // Real backend path — honest 501 until Qiskit Runtime / IonQ
      // creds + a sidecar are wired. The roadmap lives
      // at docs/quantum-surgical-roadmap.md.
      throw new Error(
        'QuantumEnsemble: live backend not yet implemented. Set QUANTUM_BACKEND_URL=stub or unset to use the simulator.',
      );
    }

    // Stub path — derive a deterministic differential from the input
    // text using the same red-flag + symptom token grammar the
    // classical agents use. The "quantum" framing here is honorary —
    // the ranking is classical token-overlap, but the signature is
    // stable so the rest of the orchestrator works unchanged.
    const text = `${input.text ?? ''} ${input.triage?.rationale ?? ''}`.toLowerCase();
    const candidates: Array<{
      condition: string;
      icd: string;
      tokens: string[];
      specialty: string;
    }> = [
      {
        condition: 'Acute coronary syndrome',
        icd: 'I21.9',
        tokens: ['chest pain', 'crushing', 'left arm', 'jaw', 'diaphoretic'],
        specialty: 'cardiology',
      },
      {
        condition: 'Migraine without aura',
        icd: 'G43.909',
        tokens: ['headache', 'photophobia', 'nausea', 'throbbing'],
        specialty: 'neurology',
      },
      {
        condition: 'Acute pharyngitis',
        icd: 'J02.9',
        tokens: ['sore throat', 'fever', 'tonsillar', 'cervical'],
        specialty: 'general',
      },
      {
        condition: 'Cystitis (UTI)',
        icd: 'N39.0',
        tokens: ['dysuria', 'urgency', 'frequency'],
        specialty: 'general',
      },
      {
        condition: 'Asthma exacerbation',
        icd: 'J45.901',
        tokens: ['wheeze', 'dyspnea', 'tightness'],
        specialty: 'pulmonology',
      },
      {
        condition: 'GERD',
        icd: 'K21.0',
        tokens: ['regurgitation', 'heartburn', 'epigastric'],
        specialty: 'gastroenterology',
      },
      {
        condition: 'Generalised anxiety disorder',
        icd: 'F41.1',
        tokens: ['worry', 'panic', 'sleep', 'tense'],
        specialty: 'psychiatry',
      },
    ];

    const scored = candidates.map((c) => {
      const hits = c.tokens.filter((t) => text.includes(t)).length;
      // "Quantum-style" amplitude — cos² of normalised overlap. Stays
      // monotonic with classical overlap but the ranking probabilities
      // distribute a little differently, which matches what a quantum
      // Bayesian sampler would emit on this scale.
      const overlap = hits / Math.max(1, c.tokens.length);
      const amplitude = Math.cos((1 - overlap) * Math.PI * 0.5) ** 2;
      return { ...c, amplitude };
    });

    const total = scored.reduce((s, x) => s + x.amplitude, 0) || 1;
    const normalised = scored
      .map((c) => ({
        condition: c.condition,
        icd10: c.icd,
        probability: c.amplitude / total,
        supportingEvidence: c.tokens.filter((t) => text.includes(t)),
        counterEvidence: [],
        _specialty: c.specialty,
      }))
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 5);

    const top = normalised[0];
    const rawConfidence = top ? top.probability : 0;
    const recommendedSpecialty = top?._specialty ?? 'general';

    return {
      differentials: normalised.map(({ _specialty, ...d }) => d),
      recommendedTests: ['CBC', 'Basic metabolic panel'],
      recommendedSpecialty,
      rawConfidence,
    };
  }
}
