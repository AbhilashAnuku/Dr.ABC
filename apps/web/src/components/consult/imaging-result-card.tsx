import { cn } from '@dr-abc/ui';
import { motion } from 'framer-motion';

/**
 * ImagingResultCard — structured radiology read for the consult page.
 *
 *   - Modality chip + backend footer
 *   - Findings list with confidence bars + severity tint
 *   - Recommended follow-up chip row
 *   - Optional segmentation overlay (PNG, base64) — rendered as a
 *     small thumbnail beside the impression
 */

interface ImagingFindingItem {
  description: string;
  location?: string;
  confidence: number;
  severity?: 'mild' | 'moderate' | 'severe' | 'critical';
}

interface ImagingResultCardProps {
  modality: string;
  impression: string;
  findings: ImagingFindingItem[];
  recommendedFollowup: string[];
  backendUsed: string;
  overlayPngBase64?: string;
}

const SEVERITY_TINT: Record<NonNullable<ImagingFindingItem['severity']>, string> = {
  mild: 'border-bio-400/30 bg-bio-500/8 text-bio-200',
  moderate: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
  severe: 'border-orange-400/40 bg-orange-500/10 text-orange-200',
  critical: 'border-rose-400/50 bg-rose-500/12 text-rose-200',
};

export function ImagingResultCard({
  modality,
  impression,
  findings,
  recommendedFollowup,
  backendUsed,
  overlayPngBase64,
}: ImagingResultCardProps) {
  const topSeverity = findings.find((f) => f.severity === 'critical' || f.severity === 'severe');
  const accent = topSeverity?.severity
    ? SEVERITY_TINT[topSeverity.severity]
    : 'border-quantum-400/30 bg-quantum-500/8 text-quantum-200';
  const modalityLabel = modality.replace('-', ' ');

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: 'easeOut', delay: 0.1 }}
      className="mt-4 overflow-hidden rounded-2xl border border-white/15 bg-linear-to-br from-white/10 via-white/4 to-white/2 backdrop-blur-2xl backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_12px_50px_-20px_rgba(0,0,0,0.6)]"
    >
      <header
        className={cn('flex items-center justify-between border-b px-4 py-2.5', 'border-white/8')}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em]',
              accent,
            )}
          >
            {modalityLabel}
          </span>
          {topSeverity?.severity && (
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
              · {topSeverity.severity}
            </span>
          )}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          {backendUsed}
        </span>
      </header>

      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="flex gap-3">
          {overlayPngBase64 && (
            <img
              src={`data:image/png;base64,${overlayPngBase64}`}
              alt="segmentation overlay"
              className="h-20 w-20 shrink-0 rounded-lg border border-white/10 object-cover"
            />
          )}
          <p className="font-grotesk text-sm leading-relaxed text-app-primary sm:text-base">
            {impression}
          </p>
        </div>

        {findings.length > 0 && (
          <div className="flex flex-col gap-2 pt-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
              Findings
            </span>
            {findings.slice(0, 5).map((f) => {
              const pct = Math.round((f.confidence ?? 0) * 100);
              return (
                <div
                  key={`${f.description}-${f.location ?? ''}`}
                  className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/3 px-3 py-2 backdrop-blur-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="font-grotesk text-sm text-app-primary">{f.description}</p>
                      {f.location && (
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
                          {f.location}
                        </p>
                      )}
                    </div>
                    <span className="font-mono text-xs tabular-nums text-app-secondary">
                      {pct}%
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-white/8">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        f.severity === 'critical'
                          ? 'bg-linear-to-r from-rose-500 to-rose-400'
                          : f.severity === 'severe'
                            ? 'bg-linear-to-r from-orange-500 to-amber-400'
                            : f.severity === 'moderate'
                              ? 'bg-linear-to-r from-amber-500 to-yellow-400'
                              : 'bg-linear-to-r from-bio-500 to-quantum-400',
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {recommendedFollowup.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
              Recommended follow-up
            </span>
            <div className="flex flex-wrap gap-1.5">
              {recommendedFollowup.slice(0, 6).map((r) => (
                <span
                  key={r}
                  className="rounded-full border border-bio-400/30 bg-bio-500/8 px-2.5 py-0.5 font-grotesk text-xs text-bio-200"
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.section>
  );
}
