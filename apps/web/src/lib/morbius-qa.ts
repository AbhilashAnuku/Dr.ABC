/**
 * morbius-qa — pre-canned Q&A bank for the project Q&A.
 *
 * Exam Q&A answered by Mörbius across the full range of its
 * capabilities. This is the script Mörbius reads when the examiner
 * asks one of the predictable questions.
 *
 * Each entry has:
 *   - q     — the question, paraphrased; matched fuzzy against examiner input
 *   - a     — the spoken answer, written for ear-not-eye (short sentences)
 *   - keys  — keyword list driving the fuzzy match
 *
 * The presenter rehearses the answers; Mörbius is the teleprompter.
 * Used by:
 *   - dev-console intro card "Ask me anything" prompt
 *   - clinic chat fallback when chiefComplaint matches an exam keyword
 *   - exported as `docs/exam-qa-script.md` (build-time) for paper backup
 */

export interface QaEntry {
  id: string;
  q: string;
  a: string;
  keys: string[];
}

export const MORBIUS_QA: QaEntry[] = [
  {
    id: 'what-is-morbius',
    q: 'What is Mörbius?',
    a: "Mörbius is a sovereign multi-agent medical AI. Five brains run in parallel: retrieval, agentic reasoning, medical knowledge, persistent memory, and self-learning. The base model is Llama 3.3 70 billion Instruct, running locally on the architect's box via Ollama. Cloud LLMs are opt-in. The platform is research-grade, not a medical device.",
    keys: ['what is', 'introduce', 'tell me about', 'morbius', 'platform', 'overview'],
  },
  {
    id: 'why-multi-agent',
    q: 'Why multi-agent — why not just call an LLM?',
    a: 'A single LLM call gives you one opinion. Mörbius runs Triage, Diagnostic, six specialists, Validator, Safety, and Privacy in a directed graph. Each agent has bounded scope, a confidence floor, and a deadline. The Validator gauntlet rejects outputs below 0.7 confidence; Safety rejects below 0.75; Privacy below 0.85 when a patient identifier is present. One model says "I think it is X". Mörbius proves X with evidence, counter-evidence, and an audit trail.',
    keys: ['multi-agent', 'why agents', 'why not single', 'orchestration', 'pipeline'],
  },
  {
    id: 'local-first',
    q: 'Why local-first?',
    a: 'Three reasons. Sovereignty: no patient data ever leaves the box without an explicit cloud key. Cost: zero per-query inference cost on the architect-grade laptop. Resilience: a clinic in a low-bandwidth setting still gets full Mörbius. The default backend priority is Ollama, then NVIDIA, HuggingFace, Anthropic. Cloud is a fallback, never the default.',
    keys: ['local', 'sovereign', 'why ollama', 'privacy first', 'on-device'],
  },
  {
    id: 'accuracy',
    q: 'How accurate is it?',
    a: 'On MedQA-USMLE single-shot, the cascade hits the high seventies. The standing target is ninety percent against Llama 3.3 70 billion Instruct — that is the architect-set floor. Per-persona harnesses score patient, doctor, and student demographics separately so demographic skew is observable, not hidden. Every diagnostic turn returns the model used, the evidence, and the counter-evidence so the examiner can audit any claim.',
    keys: ['accuracy', 'how accurate', 'benchmark', 'medqa', 'score', 'percentage'],
  },
  {
    id: 'bias',
    q: 'How does Mörbius handle bias?',
    a: 'Three layers. First, transparency: every output names the backing model and the evidence trail. Second, separated demographic scoring: the persona harness runs the same cases through patient, doctor, and student personas and writes per-persona accuracy to docs slash status. Third, the knowledge graph tags edges as extracted, inferred, or ambiguous, so the operator sees confidence not just answers. Bias does not disappear — but it stops being invisible.',
    keys: ['bias', 'fairness', 'demographic', 'race', 'gender', 'equity'],
  },
  {
    id: 'safety-floor',
    q: "What's the safety floor — what stops Mörbius from giving bad advice?",
    a: 'The Mörbius Secure Protocol is hard-coded into the system prompt with one stated goal: save at least one human life. Red-flag pathways — chest pain plus diaphoresis, sudden severe headache, hemiparesis, anaphylaxis — bypass confidence thresholds and route to immediate escalation. Validator, Safety, and Privacy run as a gauntlet — every clinical output passes all three, or the consult emits a hedge with a clinician handoff. The boosting arc — a gradient-boosting layer for sequential error correction — caps any single shift at 0.5, time-decays at 0.97 per day, and never damps confidence in red-flag conditions.',
    keys: ['safety', 'red flag', 'wrong advice', 'hallucination', 'mistake', 'guardrail'],
  },
  {
    id: 'memory',
    q: 'How does memory work?',
    a: "Two layers. The local memory is in the browser's IndexedDB — patient-bound, never visible across users, never written off-device. The activity sink mirrors a pseudonymous version into Postgres for cross-device resume when DATABASE_URL is set. The knowledge graph extracts conditions, drugs, and symptoms from every consult into a tagged graph; nodes and edges are SHA-256 cached so unchanged inputs are not reprocessed. The diff between today's graph and yesterday's becomes the LoRA fine-tune corpus — only the new twenty percent gets re-trained, lifted from the learn-anything-ten-times-faster pattern.",
    keys: ['memory', 'remember', 'persistence', 'continuity', 'graph', 'recall'],
  },
  {
    id: 'self-learning',
    q: 'What does "self-learning" actually mean?',
    a: 'Three feedback surfaces. One: the activity sink writes every consult outcome — top condition, gauntlet pass, latency, model used. Two: the calibrator runs nightly on the activity log and proposes specialist-prompt tunes; the architect approves before any prompt actually changes — so it is architect-supervised, not autonomous. Three: the boosting arc records every architect override, follow-up retraction, gauntlet failure, and autopilot signal as a residual error against the same chief-complaint signature. Next inference applies the residual, bounded to plus or minus 0.3, decaying at 0.97 per day. No kill, no sorry — Mörbius corrects itself, learns, responds.',
    keys: ['self learning', 'self-learning', 'continuous', 'improve', 'tune', 'fine tune'],
  },
  {
    id: 'compare',
    q: 'How is this different from ChatGPT or Claude?',
    a: 'Three differences. One: Mörbius is local first — your patient data never leaves the box without an explicit key. ChatGPT and Claude are by default cloud calls. Two: Mörbius is multi-agent — Triage routes to specialists, Validator gates the output, Safety enforces red-flag escalation. ChatGPT and Claude give you one opinion. Three: Mörbius has a knowledge graph and a memory — it remembers your last consult, recalls the differential, and adjusts. ChatGPT and Claude do not — every conversation starts cold.',
    keys: ['chatgpt', 'claude', 'compare', 'difference', 'gpt', 'why not'],
  },
  {
    id: 'regulation',
    q: 'Is this approved? FDA? CE? MDR?',
    a: 'No. Mörbius is research-grade, published as an MSc project artifact for academic and educational use. It is not FDA cleared, not CE marked, not MDR registered. It is a decision-support tool — the operator must always be a licensed clinician. The landing page legal section spells this out in six articles, and every consult exit emits a clinician-handoff disclaimer.',
    keys: ['fda', 'ce', 'mdr', 'approved', 'cleared', 'regulation', 'legal', 'licensed'],
  },
  {
    id: 'deploy',
    q: 'How is this deployed?',
    a: 'Local-first by design. The standard deploy is a Bun monorepo on the architect box: api on port 8787, web on 5173, py-svc on 8001, plus Postgres, Redis, Qdrant, and Ollama in Docker. For cloud demo, vercel.json deploys the web SPA, fly.toml the api, with the same code and zero environment-variable difference. Tauri 2 wraps the same React app for desktop. Capacitor wraps it for mobile.',
    keys: ['deploy', 'production', 'host', 'where running', 'cloud', 'fly', 'vercel'],
  },
  {
    id: 'data',
    q: 'What data was it trained on?',
    a: "Mörbius's diagnostic agent calls Llama 3.3 70 billion Instruct via Ollama — that model is pre-trained on public web data; we did not retrain the foundation model. The fine-tuning happens via LoRA adapters on the local box, on the disjoint set of new consult facts that landed since the last cycle, gated by the architect's approval. The knowledge graph and the seeded fifteen demo cases are explicitly fictional. No PHI is in this repository, ever.",
    keys: ['training data', 'what data', 'corpus', 'dataset', 'phi'],
  },
  {
    id: 'tone',
    q: 'Why does Mörbius talk like a warm doctor?',
    a: "Because real clinicians do. The tone classifier picks one of five tones for every reply: clinical, empathetic, reassuring, conversational, or delivering hard news. The system prompt — house tone prefix plus per-utterance tone prefix — is wrapped around every output. A purely clinical voice misses the human moment. A purely warm voice misses the diagnosis. Mörbius switches based on what the consult turn calls for. The architect's standing rule: never break the persona with 'I'm just an AI' hedging.",
    keys: ['warm', 'tone', 'persona', 'voice', 'doctor', 'empathy', 'why nice'],
  },
  {
    id: 'limits',
    q: 'What are its hard limits?',
    a: 'Five. One: it cannot replace a licensed clinician — and the system prompt says so on every reply. Two: it does not act on patient data without an explicit patient identifier hash, and even then never above privacy threshold 0.85. Three: it caps any single boosting-arc shift at 0.5 and any cumulative residual at 0.3, so the loop cannot silently flip a real diagnosis. Four: it never damps confidence in red-flag conditions even if the boosting journal says to. Five: every model call has a sixty-second deadline — if the LLM hangs, the agent fails out cleanly, no zombie request.',
    keys: ['limit', 'limitation', 'cannot', 'weakness', 'cant do', 'restriction'],
  },
  {
    id: 'future',
    q: "What's next?",
    a: 'Three horizons. Near: Llama 3.3 70 billion Instruct as the training base, ninety percent MedQA accuracy floor, and the federated-learning demo across three simulated clinics. Mid: a quantum-augmented backend — Qiskit Aer running QAOA over differential probability distributions — and a HIPAA audit-signing dashboard so the chain integrity is visible, not just present. Long: a surgical-AI variant that inherits the same five-pillar substrate for AR-guided procedure assistance. Local-first, sovereign, zero-budget — every step.',
    keys: ['future', 'next', 'roadmap', 'plans', 'horizon', 'whats next'],
  },
];

/**
 * Find the best matching Q&A entry for an incoming question.
 * Bag-of-words keyword overlap; ties broken by lower index.
 */
export function findAnswer(question: string): QaEntry | null {
  if (!question.trim()) return null;
  const tokens = question
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  let best: { entry: QaEntry; score: number } | null = null;
  for (const entry of MORBIUS_QA) {
    let score = 0;
    for (const k of entry.keys) {
      const kt = k.toLowerCase();
      // Match the question loosely: any keyword token present in the
      // question gets a point. Longer keys (multi-word) score higher.
      if (tokens.some((t) => kt.includes(t)) || kt.split(/\s+/).every((p) => tokens.includes(p))) {
        score += kt.split(/\s+/).length;
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { entry, score };
    }
  }
  return best?.entry ?? null;
}
