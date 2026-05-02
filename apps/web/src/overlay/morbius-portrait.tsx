import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

/**
 * Mörbius portrait — the canonical brand visual.
 *
 * White-and-cyan android illustration (apps/web/public/morbius/portrait.jpg)
 * with a layered cyan/emerald glow aura, a slow breathing scale, and
 * state-driven pulses (listening = bio glow ramp, speaking = quantum
 * glow + faster breath). Mouse-move on the parent gives a subtle 3D tilt.
 *
 * Use this anywhere Mörbius is the centerpiece (landing hero, dashboard
 * face panel, auth shell, splash). For the chat overlay where Mörbius
 * needs to react to live conversation, use the 3D MorbiusAvatar instead.
 */

interface PortraitProps {
  size?: number; // height in px
  speaking?: boolean;
  listening?: boolean;
  /** Show floating status chips around the portrait */
  withChips?: boolean;
  className?: string;
}

export function MorbiusPortrait({
  size = 480,
  speaking = false,
  listening = true,
  withChips = false,
  className,
}: PortraitProps) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      // Map cursor offset to a small rotation (max 6deg)
      setTilt({
        x: ((cy - e.clientY) / cy) * 6,
        y: ((e.clientX - cx) / cx) * 6,
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // Breathing — slow when idle, faster when speaking
  const breathDuration = speaking ? 1.4 : 4.2;
  // Glow tone — bio when listening, quantum when speaking, soft cyan idle
  const glowColor = speaking
    ? 'rgba(56,189,248,0.55)'
    : listening
      ? 'rgba(16,185,129,0.45)'
      : 'rgba(56,189,248,0.35)';
  const glowOuter = speaking ? 'rgba(56,189,248,0.25)' : 'rgba(56,189,248,0.18)';

  return (
    <div
      className={className}
      style={{
        height: size,
        width: '100%',
        position: 'relative',
        perspective: 1200,
      }}
    >
      {/* Outer glow halo */}
      <motion.div
        aria-hidden="true"
        animate={{
          opacity: [0.6, 1, 0.6],
          scale: [1, 1.04, 1],
        }}
        transition={{
          duration: breathDuration,
          repeat: Number.POSITIVE_INFINITY,
          ease: 'easeInOut',
        }}
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at 50% 45%, ${glowColor} 0%, ${glowOuter} 35%, transparent 70%)`,
          filter: 'blur(40px)',
          pointerEvents: 'none',
        }}
      />

      {/* Holographic ring */}
      <motion.div
        aria-hidden="true"
        animate={{ rotate: 360 }}
        transition={{ duration: 60, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
        style={{
          position: 'absolute',
          inset: '8%',
          borderRadius: '50%',
          border: '1px solid rgba(56,189,248,0.15)',
          boxShadow: 'inset 0 0 60px rgba(56,189,248,0.08)',
          pointerEvents: 'none',
        }}
      />
      <motion.div
        aria-hidden="true"
        animate={{ rotate: -360 }}
        transition={{ duration: 90, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
        style={{
          position: 'absolute',
          inset: '14%',
          borderRadius: '50%',
          border: '1px dashed rgba(16,185,129,0.18)',
          pointerEvents: 'none',
        }}
      />

      {/* The portrait itself — transparent PNG so no blend hack needed */}
      <motion.img
        src="/morbius/portrait.png"
        alt="Mörbius — sovereign quantum medical AI"
        animate={{
          scale: [1, 1.015, 1],
          y: [0, -3, 0],
        }}
        transition={{
          duration: breathDuration,
          repeat: Number.POSITIVE_INFINITY,
          ease: 'easeInOut',
        }}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          objectPosition: 'center',
          transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
          transformStyle: 'preserve-3d',
          transition: 'transform 0.18s ease-out',
          filter: speaking
            ? 'drop-shadow(0 0 28px rgba(56,189,248,0.7))'
            : listening
              ? 'drop-shadow(0 0 22px rgba(16,185,129,0.55))'
              : 'drop-shadow(0 0 16px rgba(56,189,248,0.45))',
        }}
      />

      {/* Floating chips */}
      {withChips && (
        <>
          <Chip className="left-2 top-8" tone="quantum" delay={0.6}>
            ⌬ Reasoning · idle
          </Chip>
          <Chip className="right-2 top-24" tone="bio" delay={0.8}>
            ✓ Secure Pass armed
          </Chip>
          <Chip className="left-4 bottom-20" tone="amber" delay={1.0}>
            ⚛ Quantum · classical fallback
          </Chip>
          <Chip className="right-3 bottom-8" tone="rose" delay={1.2}>
            ❤ 4 ms triage
          </Chip>
        </>
      )}
    </div>
  );
}

const CHIP_TONE = {
  quantum: 'border-quantum-400/30 text-quantum-300',
  bio: 'border-bio-500/30 text-bio-300',
  amber: 'border-amber-500/30 text-amber-300',
  rose: 'border-rose-400/30 text-rose-300',
};

function Chip({
  children,
  tone,
  className,
  delay,
}: {
  children: React.ReactNode;
  tone: keyof typeof CHIP_TONE;
  className?: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      className={`absolute inline-flex items-center gap-1.5 rounded-full border bg-ink-950/70 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] backdrop-blur-md ${CHIP_TONE[tone]} ${className ?? ''}`}
    >
      {children}
    </motion.div>
  );
}
