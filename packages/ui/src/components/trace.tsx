import type { AgentKind, AgentResult, OrchestratorEvent } from '@dr-abc/types';
import { cn } from '../cn.ts';
import { AgentBadge } from './agent-badge.tsx';
import { Card } from './card.tsx';
import { ConfidenceBar } from './confidence-bar.tsx';
import { EvidenceChip } from './evidence-chip.tsx';

export interface TraceProps {
  events: OrchestratorEvent[];
  className?: string;
}

/**
 * Trace — renders a list of OrchestratorEvent values as live cards.
 * Pure render; the consumer (apps/web/use-orchestrate) drives the stream.
 */
export function Trace({ events, className }: TraceProps) {
  if (events.length === 0) return null;
  return (
    <div className={cn('space-y-3', className)}>
      {events.map((e, i) => (
        <TraceEventCard key={`${e.type}-${i}-${eventKeyOf(e)}`} event={e} />
      ))}
    </div>
  );
}

interface CardMeta {
  agent?: AgentKind;
  glyph: string;
  label: string;
  detail: string;
  tone: 'pass' | 'warn' | 'fail' | 'star';
  confidence?: number;
  evidence?: string[];
}

function TraceEventCard({ event }: { event: OrchestratorEvent }) {
  const m = describeEvent(event);
  return (
    <Card tone={m.tone}>
      <div className="flex items-start gap-4">
        {m.agent ? (
          <AgentBadge agent={m.agent} tone={m.tone} />
        ) : (
          <span
            className={cn(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border font-mono text-sm',
              m.tone === 'star' && 'border-quantum-400/40 bg-quantum-500/15 text-quantum-400',
              m.tone === 'pass' && 'border-bio-400/30 bg-bio-500/10 text-bio-400',
              m.tone === 'warn' && 'border-amber-400/30 bg-amber-500/10 text-amber-400',
              m.tone === 'fail' && 'border-rose-400/30 bg-rose-500/10 text-rose-400',
            )}
            aria-hidden="true"
          >
            {m.glyph}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
              {m.label}
            </div>
            {m.confidence !== undefined && (
              <span className="font-mono text-[10px] text-quantum-400 tabular-nums">
                {Math.round(m.confidence * 100)}%
              </span>
            )}
          </div>
          <div className="mt-1 font-sans text-sm text-slate-200">{m.detail}</div>
          {m.confidence !== undefined && (
            <div className="mt-2">
              <ConfidenceBar value={m.confidence} showLabel={false} />
            </div>
          )}
          {m.evidence && m.evidence.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {m.evidence.slice(0, 5).map((ev) => (
                <EvidenceChip key={ev}>{ev}</EvidenceChip>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function describeEvent(e: OrchestratorEvent): CardMeta {
  switch (e.type) {
    case 'task.created':
      return {
        glyph: '◇',
        label: 'task created',
        detail: `Intent classified: ${e.task.intent} · priority ${e.task.priority}`,
        tone: 'star',
      };
    case 'agent.started':
      return {
        agent: e.agent,
        glyph: '▶',
        label: `${e.agent} started`,
        detail: `Reasoning under ${e.taskId.slice(0, 8)}…`,
        tone: 'pass',
      };
    case 'agent.token':
      return {
        agent: e.agent,
        glyph: '~',
        label: `${e.agent}`,
        detail: e.token,
        tone: 'pass',
      };
    case 'agent.completed': {
      const r = e.result as AgentResult<unknown>;
      return {
        agent: r.agent,
        glyph: '✓',
        label: `${r.agent} ${r.verdict}`,
        detail: summarizeData(r.data),
        tone: r.verdict === 'pass' ? 'pass' : r.verdict === 'fail' ? 'fail' : 'warn',
        confidence: r.confidence,
        evidence: r.evidence.slice(0, 5),
      };
    }
    case 'agent.failed':
      return {
        agent: e.agent,
        glyph: '✗',
        label: `${e.agent} failed`,
        detail: e.error,
        tone: 'fail',
      };
    case 'validation.passed':
      return {
        glyph: '✓',
        label: 'gate passed',
        detail: 'Validation gate cleared',
        tone: 'pass',
      };
    case 'validation.failed':
      return {
        glyph: '⚠',
        label: 'gate failed',
        detail: e.reason,
        tone: 'warn',
      };
    case 'pipeline.completed':
      return {
        glyph: '★',
        label: 'pipeline complete',
        detail: 'All gates passed. Ready to render.',
        tone: 'star',
      };
    case 'pipeline.aborted':
      return {
        glyph: '!',
        label: 'pipeline aborted',
        detail: e.reason,
        tone: 'fail',
      };
    case 'evidence.found':
      return {
        agent: e.agent,
        glyph: '§',
        label: `${e.agent} · ${e.evidence.length} citations`,
        detail: e.evidence
          .slice(0, 3)
          .map((ev) => `[${ev.source}] ${ev.title.slice(0, 80)}`)
          .join(' · '),
        tone: 'pass',
        evidence: e.evidence.slice(0, 5).map((ev) => ev.id),
      };
  }
}

function summarizeData(d: unknown): string {
  if (!d || typeof d !== 'object') return String(d ?? '');
  const obj = d as Record<string, unknown>;
  if ('esi' in obj && 'redFlags' in obj && 'rationale' in obj) {
    const flags = (obj.redFlags as string[]).join(', ') || 'none';
    return `ESI ${obj.esi} · flags: ${flags} · ${obj.rationale}`;
  }
  if ('differentials' in obj) {
    const diffs = obj.differentials as Array<{ condition: string; probability: number }>;
    const top = diffs[0];
    return top
      ? `${diffs.length} differentials · top: ${top.condition} (${Math.round(top.probability * 100)}%)`
      : 'no differentials';
  }
  if ('citations' in obj) {
    const cites = obj.citations as Array<{ source: string }>;
    return `${cites.length} citation(s)${cites[0] ? ` · ${cites[0].source}` : ''}`;
  }
  if ('bundle' in obj && 'message' in obj) {
    return String(obj.message);
  }
  if ('passed' in obj && 'reason' in obj) {
    return `${obj.passed ? 'PASS' : 'FAIL'} — ${obj.reason}`;
  }
  return JSON.stringify(d).slice(0, 200);
}

function eventKeyOf(e: OrchestratorEvent): string {
  switch (e.type) {
    case 'task.created':
      return e.task.taskId;
    case 'agent.started':
      return `${e.agent}-${e.taskId}-start`;
    case 'agent.token':
      return `${e.agent}-${e.token.slice(0, 12)}`;
    case 'agent.completed':
      return `${e.result.agent}-${e.result.taskId}-done`;
    case 'agent.failed':
      return `${e.agent}-fail`;
    case 'validation.passed':
    case 'validation.failed':
      return `gate-${e.taskId}-${e.type}`;
    case 'pipeline.completed':
      return `pipe-done-${e.finalResult.taskId}`;
    case 'pipeline.aborted':
      return `pipe-abort-${e.reason.slice(0, 8)}`;
    case 'evidence.found':
      return `${e.agent}-evidence-${e.evidence.length}`;
    default:
      return `unknown-${Date.now()}`;
  }
}
