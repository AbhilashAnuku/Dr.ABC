import { cn } from '@dr-abc/ui';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * MessageBubble — ChatGPT-grade message renderer.
 *
 *   user → right-pinned soft-grey rounded-2xl box, max-w-md
 *   morbius → left-aligned, full-width inside max-w-3xl, no box,
 *             small Mörbius mark + label above the body
 *
 * Body is rendered as paragraphs split on \n\n. Bold (**text**),
 * numbered lists (1. / 2.), and bullet lists (· / - / *) get
 * inline markdown rendering. The patient never sees raw markdown.
 */

interface MessageBubbleProps {
  role: 'user' | 'mörbius';
  text: string;
  /** Optional rich extra (e.g. differential card, imaging panel). */
  extra?: ReactNode;
  /** Inline image preview for user-turn imaging uploads. */
  imagePreviewUrl?: string;
  /** Which agent produced this turn (triage · chat · diagnostic · imaging · …). */
  agentLabel?: string;
  /** Triage ESI level 1-5 — 1-2 = critical, 3 = urgent, 4-5 = routine. */
  esi?: number;
  /** Specialty hint when diagnostic landed (e.g. "Cardiology"). */
  specialty?: string;
}

function EsiBadge({ esi }: { esi: number }) {
  const tone =
    esi <= 2
      ? 'border-rose-400/50 bg-rose-500/15 text-rose-200'
      : esi === 3
        ? 'border-amber-400/45 bg-amber-500/12 text-amber-200'
        : 'border-bio-400/40 bg-bio-500/10 text-bio-200';
  const label = esi <= 2 ? 'urgent' : esi === 3 ? 'priority' : 'routine';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] tabular-nums',
        tone,
      )}
      title={`Triage ESI ${esi} · ${label}`}
    >
      <span>ESI {esi}</span>
      <span className="opacity-60">·</span>
      <span>{label}</span>
    </span>
  );
}

function AgentBadge({ label }: { label: string }) {
  const glyph =
    label === 'triage'
      ? '🔍'
      : label === 'chat'
        ? '💬'
        : label === 'diagnostic'
          ? '🩺'
          : label === 'imaging'
            ? '🩻'
            : label === 'validator'
              ? '✅'
              : label === 'safety'
                ? '🛡'
                : '⚙';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-quantum-400/30 bg-quantum-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-quantum-200"
      title={`Agent: ${label}`}
    >
      <span aria-hidden="true" className="text-[10px] leading-none">
        {glyph}
      </span>
      <span>{label}</span>
    </span>
  );
}

function SpecialtyBadge({ specialty }: { specialty: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full border border-purple-400/35 bg-purple-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-purple-200"
      title={`Recommended specialty: ${specialty}`}
    >
      {specialty}
    </span>
  );
}

export function MessageBubble({
  role,
  text,
  extra,
  imagePreviewUrl,
  agentLabel,
  esi,
  specialty,
}: MessageBubbleProps) {
  const isUser = role === 'user';
  const showMeta = !isUser && (agentLabel || typeof esi === 'number' || specialty);
  // the editor pattern: user turns are right-pinned rounded boxes,
  // Mörbius replies are bubble-less flowing body with a small left
  // mark. Empty Mörbius text (mid-stream) renders nothing — the
  // typing indicator separately covers that state.
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}
    >
      {isUser ? (
        <div className="relative max-w-[min(28rem,80%)] overflow-hidden rounded-2xl rounded-tr-md border border-app-subtle bg-app-surface-strong px-4 py-2.5 text-app-primary shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_4px_16px_-6px_rgba(0,0,0,0.25)]">
          {imagePreviewUrl && (
            <img
              src={imagePreviewUrl}
              alt="attached medical frame"
              className="mb-2 max-h-56 w-full rounded-xl border border-white/10 object-cover"
            />
          )}
          <MessageBody text={text} />
        </div>
      ) : (
        <div className="flex w-full max-w-3xl gap-3">
          <div
            aria-hidden="true"
            className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-bio-400/40 bg-linear-to-br from-bio-500/20 to-quantum-500/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          >
            <span className="font-mono text-[10px] font-bold text-bio-300">M</span>
          </div>
          <div className="min-w-0 flex-1 text-app-primary">
            {showMeta && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {agentLabel && <AgentBadge label={agentLabel} />}
                {typeof esi === 'number' && <EsiBadge esi={esi} />}
                {specialty && <SpecialtyBadge specialty={specialty} />}
              </div>
            )}
            {text && <MessageBody text={text} />}
            {extra}
          </div>
        </div>
      )}
    </motion.div>
  );
}

/**
 * Minimal markdown renderer. Splits on \n\n for paragraphs, then per
 * line: bullets (· · -) or numbered (1. / 2.) become list items;
 * **bold** becomes <strong>. Anything else renders as a paragraph.
 */
function MessageBody({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2.5 font-grotesk text-[15px] leading-[1.55] text-app-primary sm:text-[15.5px]">
      {blocks.map((block) => {
        const lines = block.split('\n');
        const isNumberedList = lines.length > 1 && lines.every((l) => /^\s*\d+\.\s/.test(l));
        const isBulletList = lines.length > 1 && lines.every((l) => /^\s*[•·\-*]\s/.test(l));
        const blockKey = block.slice(0, 80);

        if (isNumberedList) {
          return (
            <ol key={blockKey} className="ml-5 list-decimal space-y-1.5 marker:text-app-faint">
              {lines.map((l) => {
                const cleaned = l.replace(/^\s*\d+\.\s+/, '');
                return (
                  <li key={cleaned}>
                    <InlineMarkdown text={cleaned} />
                  </li>
                );
              })}
            </ol>
          );
        }
        if (isBulletList) {
          return (
            <ul key={blockKey} className="ml-5 list-disc space-y-1.5 marker:text-app-faint">
              {lines.map((l) => {
                const cleaned = l.replace(/^\s*[•·\-*]\s+/, '');
                return (
                  <li key={cleaned}>
                    <InlineMarkdown text={cleaned} />
                  </li>
                );
              })}
            </ul>
          );
        }
        return (
          <p key={blockKey}>
            <InlineMarkdown text={block} />
          </p>
        );
      })}
    </div>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  // Split on **bold** runs, render <strong> for odd-indexed parts.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        const partKey = `${i}-${p.slice(0, 20)}`;
        if (p.startsWith('**') && p.endsWith('**')) {
          return (
            <strong key={partKey} className="font-semibold text-app-primary">
              {p.slice(2, -2)}
            </strong>
          );
        }
        return <span key={partKey}>{p}</span>;
      })}
    </>
  );
}
