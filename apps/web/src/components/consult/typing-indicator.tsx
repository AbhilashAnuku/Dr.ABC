import { motion } from 'framer-motion';

/**
 * Mörbius "is typing…" indicator. Three pulsing dots that ramp
 * left-to-right, used while the diagnostic / chat cascade is
 * generating the reply. Stops the chat from feeling frozen.
 *
 * Theme-token-aware (bio · quantum accents) so it reads on every
 * theme. Pure framer-motion + token classes — no extra deps.
 */
export function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      className="flex w-full max-w-2xl gap-3"
      aria-live="polite"
      aria-label="Mörbius is composing a reply"
    >
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-bio-400/40 bg-gradient-to-br from-bio-500/20 to-quantum-500/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
        <motion.span
          className="font-mono text-[10px] font-bold text-bio-300"
          animate={{ opacity: [0.55, 1, 0.55] }}
          transition={{
            duration: 1.6,
            repeat: Number.POSITIVE_INFINITY,
            ease: 'easeInOut',
          }}
        >
          M
        </motion.span>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3 py-1">
        <span className="flex items-center gap-1.5">
          {(['dot-a', 'dot-b', 'dot-c'] as const).map((id, i) => (
            <motion.span
              key={id}
              className="h-2 w-2 rounded-full bg-bio-400"
              animate={{
                opacity: [0.2, 1, 0.2],
                scale: [0.85, 1.15, 0.85],
              }}
              transition={{
                duration: 1.05,
                repeat: Number.POSITIVE_INFINITY,
                delay: i * 0.17,
                ease: 'easeInOut',
              }}
            />
          ))}
        </span>
        <span className="font-grotesk text-sm italic text-app-muted">
          Mörbius is thinking through this…
        </span>
      </div>
    </motion.div>
  );
}
