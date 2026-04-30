import { cn } from '@dr-abc/ui';
import { Brain, Cloud, Cpu, Layers, Server, Sparkles } from 'lucide-react';
import { type ComponentType, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { type BackendId, readBackendPin } from '../lib/backend-pin.ts';

/**
 * Top-bar indicator showing which backend is currently pinned.
 *
 * Listens for the `dr-abc:backend-pin` window event the picker emits
 * on every save, so the chip re-renders instantly when the backend is
 * switched in /app/settings. Click → navigates to the Backend tab.
 *
 * Color + icon are per-backend so the active backend can be confirmed
 * at a glance without opening any panel.
 */

interface BackendDescriptor {
  label: string;
  short: string;
  icon: ComponentType<{ className?: string }>;
  ring: string;
  text: string;
  bg: string;
}

const VARIANTS: Record<BackendId, BackendDescriptor> = {
  cascade: {
    label: 'Cascade',
    short: 'CASC',
    icon: Layers,
    ring: 'border-quantum-400/40',
    text: 'text-quantum-300',
    bg: 'bg-quantum-500/10',
  },
  nvidia: {
    label: 'NVIDIA NIM',
    short: 'NVDA',
    icon: Sparkles,
    ring: 'border-bio-400/40',
    text: 'text-bio-300',
    bg: 'bg-bio-500/10',
  },
  anthropic: {
    label: 'Sonnet',
    short: 'SNNT',
    icon: Brain,
    ring: 'border-purple-400/40',
    text: 'text-purple-300',
    bg: 'bg-purple-500/10',
  },
  huggingface: {
    label: 'OpenBioLLM',
    short: 'HFBL',
    icon: Cloud,
    ring: 'border-amber-400/40',
    text: 'text-amber-300',
    bg: 'bg-amber-500/10',
  },
  ollama: {
    label: 'Ollama',
    short: 'OLMA',
    icon: Server,
    ring: 'border-rose-400/40',
    text: 'text-rose-300',
    bg: 'bg-rose-500/10',
  },
};

export function BackendChip() {
  const [pin, setPin] = useState<BackendId>(() => readBackendPin());

  useEffect(() => {
    const onPinChange = (e: Event) => {
      const id = (e as CustomEvent<BackendId>).detail;
      if (id) setPin(id);
    };
    window.addEventListener('dr-abc:backend-pin', onPinChange);
    // Cross-tab sync: localStorage events fire on OTHER tabs when the
    // pin changes on one — without this, two windows diverge on which
    // backend they show.
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'dr-abc:backend-pin') setPin(readBackendPin());
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('dr-abc:backend-pin', onPinChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const v = VARIANTS[pin];
  const Icon = v.icon;
  return (
    <Link
      href="/app/settings?tab=backend"
      aria-label={`Backend: ${v.label} · click to change`}
      title={`Backend: ${v.label} · click to change`}
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-[0.18em] uppercase transition-colors',
        v.ring,
        v.text,
        v.bg,
        'hover:brightness-110',
      )}
    >
      <Cpu className="h-3 w-3 opacity-70" />
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{v.label}</span>
      <span className="sm:hidden">{v.short}</span>
    </Link>
  );
}
