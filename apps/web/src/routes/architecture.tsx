// /app/architecture — Mörbius wiring diagram, accurate to the code.
//
// What it shows: the actual data path a /orchestrate request takes
// through the system, with every node clickable to surface the file
// path that implements it. Three lanes — Input · Reasoning · Output —
// plus the standing learning loops (KG activation + sequential error
// correction) drawn underneath as orthogonal feeders.
//
// Why static SVG and not framer-motion / D3: the goal is an actual flow
// chart — the value is the diagram being AUTHORITATIVE about how the code
// is wired, not the animation. A future round can layer live agent.* SSE
// pulses on top; the static map ships first.

import { Card, Section, cn } from '@dr-abc/ui';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  Brain,
  Cog,
  Database,
  ExternalLink,
  GitBranch,
  Layers,
  Network,
  Shield,
  Sparkles,
  Stethoscope,
  Workflow,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';

interface NodeSpec {
  id: string;
  label: string;
  sub: string;
  file: string;
  icon: ReactNode;
  tone: 'in' | 'agent' | 'gate' | 'out' | 'loop';
  /** Plain-English explanation surfaced on hover. Lets a reader
   *  understand the diagram without having to open every file. */
  detail: string;
}

const NODES: NodeSpec[] = [
  {
    id: 'input',
    label: 'Patient input',
    sub: 'complaint · vitals · multimodal · prior consult-id resume',
    file: 'apps/web/src/routes/clinic.tsx',
    icon: <Stethoscope className="h-4 w-4" />,
    tone: 'in',
    detail:
      'Where the consult begins. Free-text complaint, vitals, optional voice memo / lab PDF / skin photo (multimodal fusion). Resume previous consult by URL id — every turn is persisted to localStorage + Postgres when DATABASE_URL is set.',
  },
  {
    id: 'kg-activate',
    label: 'Second Brain · activation',
    sub: 'spreading activation → grounded prompt block',
    file: 'packages/agents/src/knowledge-graph/activation.ts',
    icon: <Network className="h-4 w-4" />,
    tone: 'loop',
    detail:
      'Anderson-1983 spreading activation across the medical graph. Tokenises the complaint, seeds matched nodes, propagates with confidence-weighted edges + decay. Top-K activated nodes prepended to the prompt as authoritative grounding.',
  },
  {
    id: 'orchestrator',
    label: 'Orchestrator',
    sub: 'POST /orchestrate · SSE stream · agent dispatch',
    file: 'apps/api/src/server.ts',
    icon: <Workflow className="h-4 w-4" />,
    tone: 'agent',
    detail:
      'Hono SSE endpoint. Receives the grounded prompt, picks the right primary agent via the registry, streams every agent.* event back to the client. The dev-console pipeline-flow tab is reading this same stream live.',
  },
  {
    id: 'triage',
    label: 'Triage',
    sub: 'red-flag rules · ESI tier · intent classification',
    file: 'packages/agents/src/triage.ts',
    icon: <GitBranch className="h-4 w-4" />,
    tone: 'agent',
    detail:
      'Pure rule-based first pass. Scans for red-flag patterns (chest pain → MI rule, severe headache → SAH rule, …), assigns ESI tier 1-5, suggests downstream specialty. Never touches an LLM — runs in <1ms so the cascade has the right context.',
  },
  {
    id: 'cascade',
    label: 'Diagnostic cascade',
    sub: 'NVIDIA NIM → Anthropic → HF → Ollama (CascadingEnsemble)',
    file: 'packages/agents/src/ensembles/cascading.ts',
    icon: <Layers className="h-4 w-4" />,
    tone: 'agent',
    detail:
      'Tries each backend in priority order, falls through on timeout / error / empty differentials. 30s per-child timeout. The first backend that returns a non-empty diagnosis wins; the dev-console shows which one fired. v0.6.4 fix.',
  },
  {
    id: 'specialists',
    label: 'Specialist fan-out',
    sub: '6 specialists · routed by triage tag',
    file: 'packages/agents/src/specialists/index.ts',
    icon: <Brain className="h-4 w-4" />,
    tone: 'agent',
    detail:
      'Cardiology · Neurology · Endocrinology · Oncology · Pulmonology · Dermatology. Each has its own prompt prefix tuned on the architect-approved tuner queue. Triage tag picks one; cascade output goes through it for refinement.',
  },
  {
    id: 'boost',
    label: 'Sequential error correction',
    sub: 'gradient-boosting residuals · ±0.3 cap · 0.97/day decay',
    file: 'packages/agents/src/boosting/index.ts',
    icon: <Sparkles className="h-4 w-4" />,
    tone: 'loop',
    detail:
      'GBM-style learner. Every gauntlet failure / architect override / follow-up retraction becomes an ErrorEvent keyed by (complaint × predicted) bag-of-words SHA-256. Next inference reads the residuals and shifts the differential probabilities. AGENTS.md §13.4-bis.',
  },
  {
    id: 'gauntlet',
    label: 'Secure Pass',
    sub: 'Validator → Safety → Privacy · graded confidence',
    file: 'packages/agents/src/validator.ts',
    icon: <Shield className="h-4 w-4" />,
    tone: 'gate',
    detail:
      'Three gates in series. Validator checks evidence chain + cost budget + cited-claims. Safety checks for unsafe drug combos / contraindications. Privacy enforces patientIdHash isolation. v0.7 graded confidence — partial pass is allowed; binary all-or-nothing was nuking real diagnoses.',
  },
  {
    id: 'synth',
    label: 'Synth + tone',
    sub: 'cited-claims gate · warm-doctor tone · Mörbius Secure Protocol',
    file: 'packages/agents/src/synth/index.ts',
    icon: <Cog className="h-4 w-4" />,
    tone: 'agent',
    detail:
      'Final composition. Wraps the differential + Rx in HOUSE_TONE_PREFIX (Mörbius Secure Protocol — "save at least one human life") + tonePrefix (clinical / empathetic / reassuring / conversational / hard-news). Every clinical claim must carry a [n] footnote.',
  },
  {
    id: 'out',
    label: 'Streamed reply',
    sub: 'differentials · Rx · evidence · activity-sink + transcript persisted',
    file: 'apps/web/src/routes/clinic.tsx',
    icon: <ArrowRight className="h-4 w-4" />,
    tone: 'out',
    detail:
      'Final SSE chunk. UI shows the differential card, evidence list, optional Rx PDF download. Activity-sink writes the orchestrate.completed event. Transcript persisted per-(user, consultId) so resume works across devices.',
  },
  {
    id: 'kg-extract',
    label: 'Second Brain · extract + merge',
    sub: 'consult → nodes/edges · SHA256-cached · daily research-cycle',
    file: 'packages/agents/src/knowledge-graph/extract.ts',
    icon: <Database className="h-4 w-4" />,
    tone: 'loop',
    detail:
      "Nightly graphify pipeline. scripts/research-cycle.ts pulls the day's consults + freshly fetched abstracts, extracts new nodes/edges (EXTRACTED / INFERRED / AMBIGUOUS confidence tags), merges via SHA256-cached keys so re-runs skip unchanged sources. Brain grows every cycle.",
  },
];

const TONE_CLASS: Record<NodeSpec['tone'], string> = {
  in: 'border-quantum-400/40 bg-quantum-500/10 text-quantum-100',
  agent: 'border-bio-400/40 bg-bio-500/10 text-bio-100',
  gate: 'border-amber-400/40 bg-amber-500/10 text-amber-100',
  out: 'border-purple-400/40 bg-purple-500/10 text-purple-100',
  loop: 'border-rose-400/40 bg-rose-500/10 text-rose-100',
};

interface FlowNodeProps extends NodeSpec {
  index?: number;
}

function FlowNode({ id, label, sub, file, icon, tone, detail, index = 0 }: FlowNodeProps) {
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  return (
    <motion.a
      href={`https://github.com/AbhilashAnuku/Dr.ABC/blob/main/${file}`}
      target="_blank"
      rel="noopener noreferrer"
      data-node-id={id}
      initial={reduced ? false : { opacity: 0, y: 14 }}
      whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45, delay: Math.min(index * 0.06, 0.4), ease: [0.22, 1, 0.36, 1] }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className={cn(
        'group relative flex h-full flex-col gap-1 rounded-xl border bg-white/2 p-3 transition-colors duration-200 hover:-translate-y-0.5 hover:bg-white/5 motion-safe:hover:shadow-[0_0_24px_-12px_currentColor]',
        TONE_CLASS[tone],
      )}
    >
      <div className="flex items-center gap-2">
        <motion.span
          className="rounded-md bg-black/30 p-1.5"
          animate={
            hovered ? { rotate: [0, -6, 6, 0], scale: [1, 1.06, 1] } : { rotate: 0, scale: 1 }
          }
          transition={{ duration: 0.6 }}
        >
          {icon}
        </motion.span>
        <span className="font-display text-sm font-semibold text-app-primary">{label}</span>
        <ExternalLink className="ml-auto h-3 w-3 text-app-faint opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <p className="font-sans text-[11px] leading-snug text-app-muted">{sub}</p>
      <code className="mt-auto truncate font-mono text-[10px] text-app-faint">{file}</code>

      {/* Hover detail panel — slides up + fades in on hover, sits
          OVER the next node so wide explanations don't break the
          grid columns. Keyboard-focusable too.
          v1.0.18 fix (2026-05-10): added `visibility: hidden` when not
          hovered so the panel doesn't visually obscure the static `<p>`
          explanations that sit below the cards in the learning-loop
          row. Off-hover those explanations were rendering as "text
          behind cards" — fixed by hiding the panel entirely off-hover
          instead of just zeroing opacity. */}
      <motion.div
        initial={false}
        animate={
          hovered
            ? { opacity: 1, y: 0, pointerEvents: 'auto' }
            : { opacity: 0, y: 8, pointerEvents: 'none' }
        }
        transition={{ duration: 0.22, ease: 'easeOut' }}
        style={{ visibility: hovered ? 'visible' : 'hidden' }}
        className="absolute top-full right-0 left-0 z-30 mt-1 rounded-lg border border-app-strong bg-ink-950/95 p-3 shadow-2xl backdrop-blur"
        aria-hidden={!hovered}
      >
        <p className="font-sans text-[11px] leading-relaxed text-app-secondary">{detail}</p>
      </motion.div>
    </motion.a>
  );
}

function Arrow({ vertical = false, label }: { vertical?: boolean; label?: string }) {
  const reduced = useReducedMotion();
  return (
    <div
      className={cn(
        'flex items-center justify-center text-app-faint',
        vertical ? 'h-4 w-full flex-col' : 'h-full w-6',
      )}
    >
      <motion.span
        initial={reduced ? false : { scaleX: 0 }}
        whileInView={reduced ? undefined : { scaleX: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        style={{ originX: 0 }}
        className={cn(
          'inline-block bg-linear-to-r from-quantum-400/60 to-bio-400/60',
          vertical ? 'h-4 w-px' : 'h-px w-full',
        )}
      />
      {label && (
        <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.22em] text-app-faint">
          {label}
        </span>
      )}
    </div>
  );
}

const node = (id: string): NodeSpec => {
  const found = NODES.find((n) => n.id === id);
  if (!found) throw new Error(`unknown node ${id}`);
  return found;
};

export function ArchitecturePage() {
  return (
    <Section
      kicker="architecture · how Mörbius is wired"
      icon={Workflow}
      title="The actual flow."
      description="Every node here points at the exact file that implements it. Hover to read what it does. The top lane is the /orchestrate request path; the bottom lane is the standing learning loops (Second Brain activation, sequential error correction, Second Brain extract) that feed the cascade with grounded context and residual corrections."
    >
      {/* ─────────────────────── Main inference lane ─────────────────────── */}
      <Card className="overflow-x-auto overflow-y-visible p-4">
        <div className="mb-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-quantum-300">
          <ArrowRight className="h-3 w-3" /> inference path · /orchestrate
        </div>
        <div className="grid min-w-[1100px] grid-cols-[1.2fr_auto_1fr_auto_1.4fr_auto_1.2fr_auto_1.2fr_auto_1.2fr] items-stretch gap-2">
          <FlowNode {...node('input')} index={0} />
          <Arrow />
          <FlowNode {...node('orchestrator')} index={1} />
          <Arrow />
          <FlowNode {...node('triage')} index={2} />
          <Arrow />
          <FlowNode {...node('cascade')} index={3} />
          <Arrow />
          <FlowNode {...node('specialists')} index={4} />
          <Arrow />
          <FlowNode {...node('gauntlet')} index={5} />
        </div>
        <div className="mt-3 grid min-w-[1100px] grid-cols-[1.2fr_auto_1fr_auto_1.4fr] items-stretch gap-2">
          <div /> {/* spacer to keep gauntlet column right-aligned */}
          <Arrow />
          <FlowNode {...node('synth')} index={6} />
          <Arrow />
          <FlowNode {...node('out')} index={7} />
        </div>
      </Card>

      {/* ─────────────────────── Learning loops lane ─────────────────────── */}
      <Card className="overflow-hidden p-4">
        <div className="mb-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-rose-300">
          <Sparkles className="h-3 w-3" /> learning loops · feed back into the cascade
        </div>
        <div className="grid gap-3 lg:grid-cols-3 lg:items-stretch">
          <div className="relative flex flex-col gap-2">
            <FlowNode {...node('kg-activate')} index={8} />
            <p className="font-sans text-[11px] leading-relaxed text-app-secondary">
              Runs <em>before</em> the cascade. Every chief complaint is matched against the
              medical-graph nodes, spreading activation propagates along edges, top-K activated
              nodes get prepended to the prompt as <code>KNOWN CONTEXT FROM MÖRBIUS'S BRAIN</code>.
            </p>
          </div>
          <div className="relative flex flex-col gap-2">
            <FlowNode {...node('boost')} index={9} />
            <p className="font-sans text-[11px] leading-relaxed text-app-secondary">
              Runs <em>after</em> the cascade. Bag-of-words feature signature → residual lookup
              against the journal at <code>docs/status/boosting-journal.jsonl</code>. Bounded ±0.3,
              decays 0.97/day. <strong>No kill, no sorry</strong> — gauntlet failures become
              ErrorEvents that lift the actual condition next time.
            </p>
          </div>
          <div className="relative flex flex-col gap-2">
            <FlowNode {...node('kg-extract')} index={10} />
            <p className="font-sans text-[11px] leading-relaxed text-app-secondary">
              Runs <em>nightly</em>. <code>scripts/research-cycle.ts</code> pulls the day's consults
              + freshly fetched abstracts, extracts new nodes/edges, merges into the persistent
              graph (SHA256 cache skips unchanged sources), regenerates the analysis report.
            </p>
          </div>
        </div>
      </Card>

      {/* ─────────────────────── Legend ─────────────────────── */}
      <Card className="p-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          legend
        </div>
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-quantum-400/40 bg-quantum-500/10 px-2.5 py-1 text-quantum-200">
            input
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-bio-400/40 bg-bio-500/10 px-2.5 py-1 text-bio-200">
            agent / cascade
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-amber-200">
            gauntlet gate
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/40 bg-rose-500/10 px-2.5 py-1 text-rose-200">
            learning loop
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-400/40 bg-purple-500/10 px-2.5 py-1 text-purple-200">
            output
          </span>
        </div>
        <p className="mt-3 font-mono text-[10px] text-app-faint">
          Source-of-truth: <code>AGENTS.md §13.4-bis</code> (boosting arc) ·{' '}
          <code>docs/vault/architecture/Dr_ABC_Morbius_Architecture.md</code> (full spec).
        </p>
      </Card>
    </Section>
  );
}
