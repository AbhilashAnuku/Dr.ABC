import { cn } from '@dr-abc/ui';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

/**
 * MicWaveform — 5 vertical bars that pulse in height to simulate
 * audio levels while the user is speaking. Sits inside the composer
 * when listening = true. Theme-aware via tokens.
 *
 * Implementation: per-bar random target every 110 ms smoothed by
 * framer-motion's spring. Real waveform would need Web Audio API +
 * AnalyserNode FFT — out of scope for tonight; the random walk
 * passes as "alive" at a glance.
 */
interface MicWaveformProps {
  listening: boolean;
  className?: string;
}

const BAR_COUNT = 5;
const TICK_MS = 110;
const BAR_IDS = ['bar-a', 'bar-b', 'bar-c', 'bar-d', 'bar-e'] as const;

export function MicWaveform({ listening, className }: MicWaveformProps) {
  const [heights, setHeights] = useState<number[]>(() => new Array(BAR_COUNT).fill(0.3));

  useEffect(() => {
    if (!listening) {
      setHeights(new Array(BAR_COUNT).fill(0.2));
      return;
    }
    const interval = setInterval(() => {
      setHeights(Array.from({ length: BAR_COUNT }, () => 0.35 + Math.random() * 0.65));
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [listening]);

  return (
    <div
      className={cn(
        'flex h-9 items-center gap-[3px] px-1.5',
        listening ? 'opacity-100' : 'opacity-40',
        className,
      )}
      role="presentation"
      aria-hidden="true"
    >
      {heights.map((h, i) => (
        <motion.span
          key={BAR_IDS[i]}
          className="w-1 rounded-full bg-gradient-to-t from-bio-400 via-quantum-400 to-purple-400"
          animate={{ height: `${Math.max(h * 100, 18)}%` }}
          transition={{ type: 'spring', stiffness: 220, damping: 18 }}
          style={{ minHeight: '4px' }}
        />
      ))}
    </div>
  );
}
