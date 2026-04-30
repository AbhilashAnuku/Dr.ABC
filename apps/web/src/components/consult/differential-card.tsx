import { cn } from '@dr-abc/ui';
import { motion } from 'framer-motion';
import { AlertTriangle, FlaskConical, Stethoscope } from 'lucide-react';

/**
 * DifferentialCard — when the diagnostic agent returns a structured
 * result, this card renders below the warm-doctor text reply.
 *
 *   - Top condition as a gradient chip (rose for ESI 1-2 / amber for
 *     ESI 3 / bio for ESI 4-5).
 *   - Differentials as a numbered list with per-row probability bars.
 *   - Recommended tests as bio-coloured chips.
 *   - Specialty + model meta as small footer.
 *
 * Wraps inside MessageBubble for a Mörbius turn that carries a
 * differential payload.
 */

export interface DifferentialItem {
  condition: string;
  probability?: number;
  icd10?: string;
}

export interface DifferentialCardProps {
  topCondition: string;
  topProb: number;
  icd10?: string;
  differentials: DifferentialItem[];
  tests: string[];
  specialty: string;
  modelUsed: string;
  esi?: number;
}

function verdictTone(esi: number | undefined, topProb: number) {
  if (esi !== undefined && esi <= 2) return 'rose';
  if (esi === 3) return 'amber';
  if (topProb >= 0.7) return 'amber';
  return 'bio';
}

export function DifferentialCard({
  topCondition,
  topProb,
  icd10,
  differentials,
  tests,
  specialty,
  modelUsed,
  esi,
}: DifferentialCardProps) {
  const tone = verdictTone(esi, topProb);
  const chipClass = cn(
    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-xs uppercase tracking-[0.18em]',
    tone === 'rose' && 'border-rose-400/50 bg-rose-500/10 text-rose-200',
    tone === 'amber' && 'border-amber-400/50 bg-amber-500/10 text-amber-200',
    tone === 'bio' && 'border-bio-400/50 bg-bio-500/10 text-bio-200',
  );
  const Icon = tone === 'rose' ? AlertTriangle : Stethoscope;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.05 }}
      className="mt-4 overflow-hidden rounded-2xl border border-white/15 bg-linear-to-br from-white/10 via-white/4 to-white/2 p-5 backdrop-blur-2xl backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_12px_50px_-20px_rgba(0,0,0,0.6)]"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={chipClass}>
          <Icon className="h-3.5 w-3.5" />
          {topCondition}
        </span>
        {icd10 && (
          <span className="rounded-full border border-app-subtle bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-app-muted">
            {icd10}
          </span>
        )}
        <span className="rounded-full border border-app-subtle bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-app-muted">
          {Math.round(topProb * 100)}% confidence
        </span>
        {esi !== undefined && (
          <span className="rounded-full border border-app-subtle bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-app-muted">
            ESI {esi}
          </span>
        )}
      </div>

      {differentials.length > 1 && (
        <div className="mt-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
            other possibilities
          </div>
          <ol className="space-y-2">
            {differentials.slice(1, 5).map((d, i) => {
              const p = Math.round((d.probability ?? 0) * 100);
              return (
                <li key={`${d.condition}-${i}`} className="flex items-center gap-3">
                  <span className="w-6 font-mono text-[11px] text-app-faint">{i + 2}.</span>
                  <span className="flex-1 font-grotesk text-sm text-app-secondary">
                    {d.condition}
                    {d.icd10 && (
                      <span className="ml-2 font-mono text-[10px] text-app-faint">{d.icd10}</span>
                    )}
                  </span>
                  <div className="flex w-32 items-center gap-2">
                    <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/8">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${p}%` }}
                        transition={{ duration: 0.6, delay: 0.1 + i * 0.05 }}
                        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-quantum-400 to-purple-400"
                      />
                    </div>
                    <span className="w-9 text-right font-mono text-[10px] text-app-muted">
                      {p}%
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {tests.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
            <FlaskConical className="h-3 w-3" /> recommended tests
          </div>
          <div className="flex flex-wrap gap-2">
            {tests.map((t) => (
              <span
                key={t}
                className="rounded-full border border-bio-400/30 bg-bio-500/10 px-3 py-1 font-grotesk text-xs text-bio-200"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/8 pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
        <span>Specialty · {specialty}</span>
        <span>{modelUsed}</span>
      </div>
    </motion.div>
  );
}
