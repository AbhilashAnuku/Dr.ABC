// Voice-design presets — exactly 8 named voices used across every
// Mörbius surface. Replaces the dual "personas + raw OS" picker with
// one list of 8: 3 male, 3 female, 2 robotic.
//
// Each preset wraps an underlying OS voice identity (lib/voice.ts) with
// a friendly name, tone label, and sample line. The picker lists ONLY
// these eight; the raw MORBIUS_VOICES list is internal-only now.
//
// Honest disclosure: the actual rendered voice depends on the OS's
// installed voices. If "Aria" isn't on the system, the auto-picker
// falls back to the next-best female voice + the preset's prosody
// settings still apply.

import type { VoiceId } from './voice.ts';

export type PresetTone =
  | 'warm'
  | 'professional'
  | 'energetic'
  | 'calm'
  | 'clear'
  | 'authoritative'
  | 'clean'
  | 'futuristic';

export interface VoicePreset {
  /** Stable id — persisted to localStorage. */
  id: 'aria' | 'vera' | 'nova' | 'daniel' | 'davis' | 'atlas' | 'morbius' | 'echo';
  /** User-facing name. */
  name: string;
  /** One-line description for the picker. */
  description: string;
  /** Audit-defined tone bucket. */
  tone: PresetTone;
  /** 'female' | 'male' | 'robotic' — drives the picker's grouping. */
  family: 'female' | 'male' | 'robotic';
  /** Underlying voice identity this preset maps to. */
  identity: VoiceId;
  /** Played when the user picks the preset — they hear the persona. */
  sampleLine: string;
  /** Where this preset shines — guides the picker hint. */
  context: string;
}

export const VOICE_PRESETS: readonly VoicePreset[] = [
  // ── Female · 3 ──
  {
    id: 'aria',
    name: 'Aria',
    description: 'Calm, doctor-bedside. Warm, unhurried, never clinical-cold.',
    tone: 'warm',
    family: 'female',
    identity: 'female-1',
    sampleLine: 'Take your time. Walk me through what brought you in today.',
    context: 'Best for patient consults — empathy first, diagnosis second.',
  },
  {
    id: 'vera',
    name: 'Vera',
    description: 'Crisp clinical, slight British inflection. Trusts the data.',
    tone: 'professional',
    family: 'female',
    identity: 'female-1',
    sampleLine:
      'Reviewing your vitals — heart rate one hundred ten, oxygen saturation ninety-six. Continuing.',
    context: 'Best for chart review, hand-offs, structured read-outs.',
  },
  {
    id: 'nova',
    name: 'Nova',
    description: 'Bright, encouraging. Patient-mode follow-up energy.',
    tone: 'energetic',
    family: 'female',
    identity: 'female-1',
    sampleLine:
      'Great progress. Two days off the medication and your blood pressure is already responding.',
    context: 'Best for self-care cards, follow-ups, recovery check-ins.',
  },
  // ── Male · 3 ──
  {
    id: 'daniel',
    name: 'Daniel',
    description: 'British baritone. Calm, considered, never rushed.',
    tone: 'calm',
    family: 'male',
    identity: 'male-1',
    sampleLine:
      "Let's go through what we know — and what we don't yet — together. One step at a time.",
    context: 'Best for delivering hard news, post-op, and chronic-care check-ins.',
  },
  {
    id: 'davis',
    name: 'Davis',
    description: 'American warm. The friendly attending who explains things twice.',
    tone: 'warm',
    family: 'male',
    identity: 'male-1',
    sampleLine: 'Good question. Here is what the guideline says — and what I would do for you.',
    context: 'Best for patient education and informed-consent conversations.',
  },
  {
    id: 'atlas',
    name: 'Atlas',
    description: 'Clear, neutral. The trusted second-opinion voice.',
    tone: 'clear',
    family: 'male',
    identity: 'male-1',
    sampleLine:
      'Based on the evidence presented, the most likely differential is acute coronary syndrome.',
    context: 'Best for second-opinion / academic read-outs and peer review.',
  },
  // ── Robotic · 2 ──
  {
    id: 'morbius',
    name: 'Mörbius',
    description: 'Neutral, unhedged. The default. Clean baritone, no pretence.',
    tone: 'clean',
    family: 'robotic',
    identity: 'system',
    sampleLine: 'I am Mörbius. Secure Pass armed. Ready.',
    context: 'Default for the orchestrator surface and the brain map.',
  },
  {
    id: 'echo',
    name: 'Echo',
    description: 'Slight metallic edge. The dev-console voice.',
    tone: 'futuristic',
    family: 'robotic',
    identity: 'system',
    sampleLine: 'Cascade vector cleared. Sample variance zero point one four.',
    context: 'Best for the dev console — the engineering surface speaking back.',
  },
] as const;

export type VoicePresetId = (typeof VOICE_PRESETS)[number]['id'];

const PRESET_KEY = 'dr-abc:voice-preset';

export function readVoicePreset(): VoicePresetId | null {
  if (typeof window === 'undefined') return null;
  const v = window.localStorage.getItem(PRESET_KEY);
  if (v && VOICE_PRESETS.some((p) => p.id === v)) return v as VoicePresetId;
  return null;
}

export function writeVoicePreset(id: VoicePresetId | null): void {
  if (typeof window === 'undefined') return;
  if (id === null) window.localStorage.removeItem(PRESET_KEY);
  else window.localStorage.setItem(PRESET_KEY, id);
}

export function getPresetById(id: VoicePresetId): VoicePreset | undefined {
  return VOICE_PRESETS.find((p) => p.id === id);
}
