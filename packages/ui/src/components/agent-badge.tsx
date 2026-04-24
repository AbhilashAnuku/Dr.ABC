import type { AgentKind } from '@dr-abc/types';
import { cn } from '../cn.ts';

export interface AgentBadgeProps {
  agent: AgentKind;
  size?: 'sm' | 'md';
  tone?: 'pass' | 'warn' | 'fail' | 'star';
  className?: string;
}

const TONE = {
  pass: 'border-bio-400/30 bg-bio-500/10 text-bio-400',
  warn: 'border-amber-400/30 bg-amber-500/10 text-amber-400',
  fail: 'border-rose-400/30 bg-rose-500/10 text-rose-400',
  star: 'border-quantum-400/40 bg-quantum-500/15 text-quantum-400',
} as const;

const SIZE = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-8 w-8 text-sm',
} as const;

/**
 * The square-icon badge that prefixes every event in the live trace.
 * Picks a glyph per agent kind so readers can scan the trace visually.
 */
const GLYPH: Record<AgentKind, string> = {
  orchestrator: 'O',
  triage: 'T',
  diagnostic: 'D',
  chat: '💬',
  imaging: 'I',
  'anatomy-sim': 'A',
  quantum: 'Q',
  prescription: 'Rx',
  pharma: 'P',
  library: 'L',
  profile: 'Pr',
  research: 'R',
  gesture: 'G',
  voice: 'V',
  'ui-ux': 'U',
  validator: '✓',
  safety: 'S',
  privacy: 'π',
  // Stage 8 specialists.
  cardiology: '♥',
  neurology: '🧠',
  oncology: '⊕',
  pulmonology: '🫁',
  endocrinology: 'E',
  dermatology: 'd',
};

export function AgentBadge({ agent, size = 'md', tone = 'pass', className }: AgentBadgeProps) {
  return (
    <span
      title={agent}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg border font-mono',
        SIZE[size],
        TONE[tone],
        className,
      )}
      aria-label={`${agent} agent`}
    >
      {GLYPH[agent] ?? '?'}
    </span>
  );
}
