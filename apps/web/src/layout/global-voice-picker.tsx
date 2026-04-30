// TODO(i18n): per the standing-rule (memory: new-component-rules), wrap
// "Mute / Unmute / Open voice picker / Voice on / Mörbius voice — picks
// instantly / System default" in t() once we add a `voicePicker` i18n
// namespace to en/de/hi.json. Brand-name labels ("Mörbius · Daniel")
// stay untranslated.
import { cn } from '@dr-abc/ui';
import { Mic, MicOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  VOICE_PRESETS,
  type VoicePresetId,
  readVoicePreset,
  writeVoicePreset,
} from '../lib/voice-presets.ts';
import {
  MORBIUS_VOICES,
  type VoiceId,
  readVoiceId,
  readVoiceQuality,
  speakWithProsody,
  writeVoiceId,
  writeVoiceQuality,
} from '../lib/voice.ts';

/**
 * Global voice picker — lives in the top bar so any user can change
 * Mörbius's voice from any page without scrolling to Settings. Same
 * source-of-truth as Settings (writeVoiceId → localStorage → next
 * speak() picks it up).
 *
 * Distinguishes voice identity from voice quality:
 *   - Voice IDENTITY = which voice (Daniel, Aria, Synth-A, …) — 9 options
 *   - Voice QUALITY  = how synthesis happens (tuned per-clause prosody
 *                      vs single utterance vs muted)
 * This picker only exposes IDENTITY. The mute toggle here flips quality
 * between 'tuned' and 'off' — that's the only quality change anyone
 * needs in normal use.
 */
export function GlobalVoicePicker() {
  const [open, setOpen] = useState(false);
  const [voiceId, setVoiceId] = useState<VoiceId>(() => readVoiceId());
  const [presetId, setPresetIdState] = useState<VoicePresetId | null>(() => readVoicePreset());
  const [muted, setMuted] = useState<boolean>(() => readVoiceQuality() === 'off');
  const ref = useRef<HTMLDivElement | null>(null);

  // Close the dropdown on outside click / escape.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const pick = (id: VoiceId) => {
    writeVoiceId(id);
    setVoiceId(id);
    // Picking a raw voice clears any active preset — they're alternative
    // ways of choosing the same thing.
    writeVoicePreset(null);
    setPresetIdState(null);
    setOpen(false);
    // Speak a short sample so the user hears the new voice immediately.
    if (!muted) {
      const meta = MORBIUS_VOICES.find((v) => v.id === id);
      speakWithProsody(`Hello — I'm Mörbius. ${meta?.label ?? 'Voice updated.'}`, {
        identity: id,
      });
    }
  };

  const pickPreset = (id: VoicePresetId) => {
    const preset = VOICE_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    // A preset = a named persona that maps to one underlying voice
    // identity + carries its own sample line. Set both so the rest of
    // the app's lookups stay consistent.
    writeVoiceId(preset.identity);
    setVoiceId(preset.identity);
    writeVoicePreset(id);
    setPresetIdState(id);
    setOpen(false);
    if (!muted) {
      speakWithProsody(preset.sampleLine, { identity: preset.identity });
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    writeVoiceQuality(next ? 'off' : 'tuned');
    if (!next) {
      speakWithProsody('Voice on.', { identity: voiceId });
    }
  };

  const active = MORBIUS_VOICES.find((v) => v.id === voiceId) ?? MORBIUS_VOICES[0];
  const activePreset = presetId ? VOICE_PRESETS.find((p) => p.id === presetId) : null;

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-1 rounded-full border border-app-subtle">
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? 'Unmute Mörbius' : 'Mute Mörbius'}
          title={muted ? 'Unmute Mörbius' : 'Mute Mörbius'}
          className={cn(
            'rounded-l-full p-1.5 transition-colors',
            muted ? 'text-rose-300 hover:text-rose-200' : 'text-bio-300 hover:text-bio-200',
          )}
        >
          {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded-r-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-app-muted transition-colors hover:text-app-primary"
          title={`Voice: ${active?.label ?? 'system'}`}
        >
          <span className="hidden truncate sm:inline" style={{ maxWidth: 96 }}>
            {/* Active preset name beats raw voice label — Aria reads
                cleaner than "Mörbius · Aria" in the topbar. */}
            {activePreset?.name ?? active?.label?.replace(/^Mörbius · /, '') ?? 'System'}
          </span>
          <span className="sm:hidden">voice</span>
          <svg
            viewBox="0 0 12 12"
            className="h-2.5 w-2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            role="img"
            aria-label="Open voice picker"
          >
            <path d="M3 4l3 3 3-3" />
          </svg>
        </button>
      </div>
      {open && (
        <div className="absolute right-0 z-[60] mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-xl border border-app-subtle bg-app-surface/95 p-1 shadow-lg backdrop-blur-xl">
          {/* Eight voices · 3 female · 3 male · 2 robotic.
              One list, exactly 8. Underlying OS voice IDs live in
              lib/voice.ts as MORBIUS_VOICES — internal-only now. */}
          <div className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.22em] text-quantum-300">
            Voices · 3 female · 3 male · 2 robotic
          </div>
          {VOICE_PRESETS.map((p) => {
            const isActive = p.id === presetId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => pickPreset(p.id)}
                className={cn(
                  'flex w-full flex-col items-start rounded-lg px-3 py-1.5 text-left transition-colors',
                  isActive
                    ? 'bg-quantum-500/15 text-quantum-200'
                    : 'text-app-secondary hover:bg-white/5',
                )}
              >
                <div className="flex w-full items-baseline justify-between">
                  <span className="font-display text-sm font-semibold">
                    {p.name}{' '}
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-app-faint">
                      · {p.family}
                    </span>
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-app-faint">
                    {p.tone}
                  </span>
                </div>
                <span className="font-sans text-[11px] text-app-muted">{p.description}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
