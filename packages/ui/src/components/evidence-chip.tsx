import type { ReactNode } from 'react';
import { cn } from '../cn.ts';

export interface EvidenceChipProps {
  tone?: 'bio' | 'amber' | 'rose' | 'quantum';
  className?: string;
  children: ReactNode;
}

const TONE = {
  bio: 'border-bio-500/20 bg-bio-500/5 text-bio-400',
  amber: 'border-amber-500/20 bg-amber-500/5 text-amber-400',
  rose: 'border-rose-500/20 bg-rose-500/5 text-rose-400',
  quantum: 'border-quantum-400/20 bg-quantum-500/5 text-quantum-400',
} as const;

export function EvidenceChip({ tone = 'bio', className, children }: EvidenceChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[10px]',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
