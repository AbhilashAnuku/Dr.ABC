/**
 * Mörbius voice — one voice, many possible identities, and one
 * speaking-state flag so the recognition loop never hears Mörbius
 * itself.
 *
 * Three responsibilities, in order of importance:
 *
 *   1. **Voice pinning** — once a voice is picked (either by the user
 *      via Settings, or by the auto-picker on first speak), the same
 *      `SpeechSynthesisVoice` instance is reused for every utterance
 *      for the rest of the session. The previous bug — `pickBestVoice`
 *      re-running each speak() and the OS returning voices in
 *      different order — meant Mörbius swapped voices mid-sentence on
 *      some Windows builds. Fixed.
 *
 *   2. **8 selectable voice identities** — 3 male, 3 female, 2
 *      robotic. Default is `system` (auto-pick best for OS / locale).
 *      User picks one in Settings → Appearance → "Mörbius voice".
 *      Identity is mapped to a per-OS voice-name pattern at
 *      resolve-time; if the OS doesn't have the requested family, we
 *      fall back to the auto-pick rather than failing silent.
 *
 *   3. **`isMorbiusSpeaking()`** — global flag the SpeechRecognition
 *      listeners check before processing a transcript. While Mörbius
 *      is mid-sentence, the recognition's onresult is a no-op so its
 *      mic doesn't pick up Mörbius's own TTS audio, preventing a
 *      listen/speak feedback loop. Cleared on speech end / cancel.
 */

const QUALITY_KEY = 'dr-abc:voice-quality';
const VOICE_ID_KEY = 'dr-abc:voice-id';

export type VoiceQuality = 'tuned' | 'system' | 'off';

/**
 * The 8 voice identities the user can pick. `system` is the default
 * and uses the auto-picker. The other 8 (3M / 3F / 2 robo) try to
 * resolve to specific OS voice families; resolution falls back to
 * auto-pick when the family isn't available.
 *
 * Names + genders are the user-facing labels in Settings.
 */
// A single inbuilt voice, male or female per user preference, with one
// warm-doctor tone. The 9-identity roster collapsed to three options —
// system / male / female — every one of them resolving to the best
// Natural / Premium voice the OS has installed. Tone deltas dropped
// too: there is one prosody now, warm-doctor.
export const MORBIUS_VOICES = [
  {
    id: 'system',
    label: 'System default',
    tone: 'neutral' as const,
    hint: 'Best voice for your OS / locale',
  },
  {
    id: 'male-1',
    label: 'Mörbius · male',
    tone: 'male' as const,
    hint: 'Warm-doctor · male presence',
  },
  {
    id: 'female-1',
    label: 'Mörbius · female',
    tone: 'female' as const,
    hint: 'Warm-doctor · female presence',
  },
] as const;

export type VoiceId = (typeof MORBIUS_VOICES)[number]['id'];

/** Per-identity OS voice-name regex preference list. First match wins.
 *  Each ID resolves to the best Natural / Premium voice the OS has
 *  installed; we no longer differentiate within male/female because
 *  the roster is a single warm-doctor voice per gender. */
const VOICE_PATTERNS: Record<VoiceId, RegExp[]> = {
  system: [],
  'male-1': [
    /Davis Online \(Natural\)/i,
    /Guy Online \(Natural\)/i,
    /Tony Online \(Natural\)/i,
    /Daniel \(Premium\)/i,
    /Daniel \(Enhanced\)/i,
    /^Daniel$/i,
    /Microsoft Davis/i,
    /Microsoft Guy/i,
    /Microsoft Tony/i,
    /Google US English/i,
    /Google UK English Male/i,
  ],
  'female-1': [
    /Aria Online \(Natural\)/i,
    /Jenny Online \(Natural\)/i,
    /Sara Online \(Natural\)/i,
    /Samantha \(Premium\)/i,
    /Samantha \(Enhanced\)/i,
    /Karen \(Enhanced\)/i,
    /^Samantha$/i,
    /Microsoft Aria/i,
    /Microsoft Jenny/i,
    /Microsoft Zira/i,
    /Google UK English Female/i,
  ],
};

const VOICE_PATTERNS_DE: Record<VoiceId, RegExp[]> = {
  system: [],
  'male-1': [
    /Conrad Online \(Natural\)/i,
    /Bernd Online \(Natural\)/i,
    /Stefan Online \(Natural\)/i,
    /Microsoft Conrad/i,
    /Microsoft Stefan/i,
    /^Stefan$/i,
    /Markus/i,
  ],
  'female-1': [
    /Katja Online \(Natural\)/i,
    /Hedda Online \(Natural\)/i,
    /Amala Online \(Natural\)/i,
    /Louisa Online \(Natural\)/i,
    /Microsoft Katja/i,
    /Microsoft Hedda/i,
    /^Anna$/i,
    /^Petra$/i,
  ],
};

// ============================================================
//  Voice quality (existing surface, kept stable)
// ============================================================

export function readVoiceQuality(): VoiceQuality {
  if (typeof window === 'undefined') return 'tuned';
  const v = window.localStorage.getItem(QUALITY_KEY);
  if (v === 'system' || v === 'off') return v;
  return 'tuned';
}

export function writeVoiceQuality(v: VoiceQuality) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(QUALITY_KEY, v);
}

// ============================================================
//  Voice identity
// ============================================================

export function readVoiceId(): VoiceId {
  if (typeof window === 'undefined') return 'system';
  const v = window.localStorage.getItem(VOICE_ID_KEY);
  if (!v) return 'system';
  if (MORBIUS_VOICES.some((opt) => opt.id === v)) return v as VoiceId;
  return 'system';
}

export function writeVoiceId(id: VoiceId): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(VOICE_ID_KEY, id);
  // Drop the cached pinned voice so the next speak() re-resolves.
  pinnedVoice = null;
}

// ============================================================
//  Voice picker — pinned for the session, auto + identity-aware
// ============================================================

// Prefer modern, advanced text-to-speech voices. On Windows the modern
// *Online (Natural)* voices are dramatically better than the legacy
// SAPI Desktop voices. We PREFER Natural variants explicitly, then fall
// back to Desktop.
// On Mac, "Premium" + "(Enhanced)" voices are the equivalent. On Linux,
// pico/festival is robotic — Google voices via Chrome are the best
// browser-native option.
const PREFERRED_BY_OS_AUTO: { os: 'windows' | 'mac' | 'linux' | 'other'; pattern: RegExp[] }[] = [
  {
    os: 'windows',
    pattern: [
      // Online Natural voices (Edge / Chromium · available once "Add a
      // voice" lists "Aria Online" in Windows Settings → Time & Language
      // → Speech).
      /Aria Online \(Natural\)/i,
      /Jenny Online \(Natural\)/i,
      /Guy Online \(Natural\)/i,
      /Davis Online \(Natural\)/i,
      /Tony Online \(Natural\)/i,
      /Sara Online \(Natural\)/i,
      /Nancy Online \(Natural\)/i,
      // Generic "Natural" tag (some Chromium builds normalise it)
      /Natural/i,
      // Desktop SAPI fallback
      /Microsoft Aria/i,
      /Microsoft Jenny/i,
      /Microsoft Guy/i,
      /Microsoft Davis/i,
      /Microsoft Zira/i,
    ],
  },
  {
    os: 'mac',
    pattern: [
      /Premium/i,
      /Samantha \(Enhanced\)/i,
      /Karen \(Enhanced\)/i,
      /Daniel \(Enhanced\)/i,
      /Ava \(Premium\)/i,
      /^Samantha$/i,
      /^Karen$/i,
    ],
  },
  {
    os: 'linux',
    pattern: [/Google US English/i, /Google UK English Female/i, /Chrome OS/i, /Mbrola/i],
  },
  { os: 'other', pattern: [/Natural/i, /Premium/i, /Enhanced/i] },
];

function detectOs(): 'windows' | 'mac' | 'linux' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/Win/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua)) return 'mac';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'other';
}

export interface PickBestVoiceOpts {
  lang?: string;
  os?: 'windows' | 'mac' | 'linux' | 'other';
  voices?: SpeechSynthesisVoice[];
  /** Specific identity (defaults to whatever readVoiceId returns). */
  identity?: VoiceId;
}

export function pickBestVoice(opts: PickBestVoiceOpts = {}): SpeechSynthesisVoice | null {
  const list =
    opts.voices ??
    (typeof window !== 'undefined' && 'speechSynthesis' in window
      ? window.speechSynthesis.getVoices()
      : []);
  if (list.length === 0) return null;

  const os = opts.os ?? detectOs();
  const lang = opts.lang;
  const baseLang = lang?.split('-')[0]?.toLowerCase();
  const identity = opts.identity ?? readVoiceId();

  // Step 0 — if the user picked an explicit identity, try its
  // pattern list first. When the active locale is German, prefer the
  // German-accent overlay (Conrad / Katja / Hedda Online Natural) so a
  // de-DE consult sounds professionally German, not English-with-accent.
  if (identity !== 'system') {
    const patternsForIdentity =
      baseLang === 'de'
        ? [...VOICE_PATTERNS_DE[identity], ...VOICE_PATTERNS[identity]]
        : VOICE_PATTERNS[identity];
    for (const re of patternsForIdentity) {
      const hit = list.find(
        (v) => re.test(v.name) && (!baseLang || v.lang.toLowerCase().startsWith(baseLang)),
      );
      if (hit) return hit;
      // Try without lang filter — better to honour identity than locale
      // when the user explicitly picked a voice.
      const anyLangHit = list.find((v) => re.test(v.name));
      if (anyLangHit) return anyLangHit;
    }
    // Fall through to auto-pick when identity isn't on this OS.
  }

  // Step 1 — auto-pick: per-OS preferred names within the requested locale.
  const osTable = PREFERRED_BY_OS_AUTO.find((t) => t.os === os) ?? PREFERRED_BY_OS_AUTO[3];
  if (osTable) {
    for (const re of osTable.pattern) {
      const hit = list.find(
        (v) => re.test(v.name) && (!baseLang || v.lang.toLowerCase().startsWith(baseLang)),
      );
      if (hit) return hit;
    }
  }

  // Step 2 — any voice whose lang matches the requested locale.
  if (baseLang) {
    const localHit = list.find((v) => v.lang.toLowerCase().startsWith(baseLang) && v.localService);
    if (localHit) return localHit;
    const remoteHit = list.find((v) => v.lang.toLowerCase().startsWith(baseLang));
    if (remoteHit) return remoteHit;
  }

  // Step 3 — first non-Google voice of any locale, then anything.
  return list.find((v) => !/google/i.test(v.name)) ?? list[0] ?? null;
}

// ============================================================
//  Pinned voice cache — the major-bug fix
// ============================================================

let pinnedVoice: SpeechSynthesisVoice | null = null;
let pinnedFor: { lang: string; identity: VoiceId } | null = null;

function getPinnedVoice(lang: string, identity: VoiceId): SpeechSynthesisVoice | null {
  if (pinnedVoice && pinnedFor && pinnedFor.lang === lang && pinnedFor.identity === identity) {
    return pinnedVoice;
  }
  pinnedVoice = pickBestVoice({ lang, identity });
  pinnedFor = pinnedVoice ? { lang, identity } : null;
  return pinnedVoice;
}

export function getPinnedVoiceName(): string | null {
  return pinnedVoice?.name ?? null;
}

// ============================================================
//  Speaking state — the echo-prevention flag
// ============================================================

let speakingCount = 0;
const SPEAKING_LISTENERS = new Set<(speaking: boolean) => void>();

// ============================================================
//  Lip-sync amplitude — driven by SpeechSynthesisUtterance
//  `boundary` events (one per word) plus a per-frame decay.
//
//  The Web Speech API does not expose audio output amplitude (no way
//  to feed it through an AnalyserNode), so we approximate: each word
//  boundary event spikes the amplitude, then it decays at roughly the
//  speech rate. The result reads as a real lip-sync — mouth opens
//  on syllable starts, closes between words, and rests at 0 when
//  not speaking. The face component samples this every frame.
// ============================================================

let lipSyncAmp = 0;
let lipSyncSpikeAt = 0;

/** Read the current lip-sync amplitude (0..1). Sample per frame from
 *  Three.js's useFrame; the value decays automatically. */
export function getMouthAmplitude(): number {
  if (lipSyncAmp <= 0.01) return 0;
  // Decay model: high spike → fast fall; low → slower fall. Tuned by ear.
  const now = performance.now();
  const dt = (now - lipSyncSpikeAt) / 1000;
  const decayed = lipSyncAmp * Math.exp(-dt * 6.5);
  return Math.max(0, Math.min(1, decayed));
}

function spikeMouth(intensity = 0.9): void {
  lipSyncAmp = Math.min(1, lipSyncAmp * 0.4 + intensity);
  lipSyncSpikeAt = performance.now();
}

function clearMouth(): void {
  lipSyncAmp = 0;
  lipSyncSpikeAt = performance.now();
}

/**
 * True while at least one Mörbius utterance is queued or speaking,
 * PLUS for a 1.4-second grace window after the last one ends.
 *
 * Guards against Mörbius transcribing its own spoken output as input.
 * The OS speech-synthesis flag flips false the
 * moment the queue drains, but the audio echo from speakers reaches
 * the microphone with ~200-1000 ms of lag — and the SpeechRecognition
 * keeps emitting `onresult` events transcribing Mörbius's tail. The
 * grace window covers that latency: any transcript arriving up to
 * 1.4 s after Mörbius stopped is treated as echo and dropped.
 */
let lastSpokeAt = 0;
const ECHO_GRACE_MS = 1_400;

export function isMorbiusSpeaking(): boolean {
  if (speakingCount > 0) return true;
  if (lastSpokeAt > 0 && Date.now() - lastSpokeAt < ECHO_GRACE_MS) return true;
  return false;
}

export function onSpeakingChange(cb: (speaking: boolean) => void): () => void {
  SPEAKING_LISTENERS.add(cb);
  return () => {
    SPEAKING_LISTENERS.delete(cb);
  };
}

function setSpeaking(delta: 1 | -1) {
  const wasSpeaking = speakingCount > 0;
  speakingCount = Math.max(0, speakingCount + delta);
  const isSpeaking = speakingCount > 0;
  if (wasSpeaking !== isSpeaking) {
    if (!isSpeaking) lastSpokeAt = Date.now();
    for (const cb of SPEAKING_LISTENERS) cb(isSpeaking);
  }
}

// ============================================================
//  Clause splitting — punctuation-aware cadence
//
//  Models the grammar of speech — where to pause and stop — for a
//  natural cadence. Each clause carries a trailing-punctuation tag and
//  the speak loop scales the pause by punctuation:
//    period · question · exclamation → full sentence stop
//    semicolon · colon                → medium breath
//    em-dash · comma                  → short breath
//
//  The clause splitter ALSO breaks on em-dashes and commas (when
//  they're sentence-internal), not just sentence-final punctuation.
//  That gives the prosody a natural rise-fall on long sentences.
// ============================================================

const ABBREV_RE = /\b(Dr|Mr|Mrs|Ms|Prof|St|Mt|Sr|Jr|etc|vs|e\.g|i\.e|No)\.$/i;

export type ClausePauseKind = 'sentence' | 'breath' | 'comma' | 'none';

export interface ClauseSegment {
  text: string;
  pause: ClausePauseKind;
}

/** Sentence-level split (period / question / exclamation / semicolon). */
function splitOnSentence(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed
    .split(/(?<=[.!?;])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const last = out.length > 0 ? (out[out.length - 1] ?? '') : '';
    if (last && ABBREV_RE.test(last)) {
      out[out.length - 1] = `${last} ${p}`;
    } else {
      out.push(p);
    }
  }
  return out;
}

/** Sub-split a sentence on em-dashes / colons / mid-sentence commas
 *  · gives Mörbius natural breath points inside long sentences. */
function splitOnBreath(sentence: string): ClauseSegment[] {
  // Keep separators by capturing them; we rebuild text + pause kind.
  const tokens = sentence.split(/(\s—\s|\s–\s|: | · |,\s)/);
  const out: ClauseSegment[] = [];
  let current = '';
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] ?? '';
    if (i % 2 === 0) {
      current += tok;
    } else {
      // separator
      const t = tok.trim();
      const pause: ClausePauseKind =
        t === '—' || t === '–' || t === ':' || t === '·' ? 'breath' : 'comma';
      const trimmed = current.trim();
      if (trimmed.length >= 4) {
        // Don't split on tiny fragments; keep the comma inline.
        out.push({ text: trimmed, pause });
        current = '';
      } else {
        // Re-attach the separator to the in-progress fragment.
        current += tok;
      }
    }
  }
  const tail = current.trim();
  if (tail) {
    out.push({ text: tail, pause: 'sentence' });
  } else if (out.length > 0) {
    // Promote the last comma/breath to a sentence-end stop.
    const last = out[out.length - 1];
    if (last) last.pause = 'sentence';
  }
  return out;
}

/**
 * Top-level splitter — takes the full text, returns ClauseSegment[]
 * with a punctuation-aware pause tag attached.
 *
 * Two-stage: sentence-level (period/question/etc.) then sub-split on
 * em-dashes + colons + mid-sentence commas. Final clause of every
 * sentence gets a `'sentence'` pause regardless of how it ended.
 */
export function splitIntoSegments(text: string): ClauseSegment[] {
  const sentences = splitOnSentence(text);
  const out: ClauseSegment[] = [];
  for (const s of sentences) {
    const segs = splitOnBreath(s);
    for (const seg of segs) out.push(seg);
  }
  // Final clause — no pause needed, audio just ends.
  if (out.length > 0) {
    const last = out[out.length - 1];
    if (last) last.pause = 'none';
  }
  return out;
}

/** Backwards-compatible: returns plain text clauses. Used by the
 *  legacy single-utterance branch in speakWithProsody. */
export function splitIntoClauses(text: string): string[] {
  return splitIntoSegments(text).map((s) => s.text);
}

// ============================================================
//  Conversational fillers — small phrases for natural turns
// ============================================================

const THINKING_FILLERS = [
  'Let me think.',
  'One moment.',
  'Hmm, give me a second.',
  'Looking at this carefully.',
  "Let's see.",
];

const ACK_FILLERS = ['Got it.', 'Understood.', 'Hearing you.', 'Mm-hm.', 'Right.'];

/** Pick a deterministic filler. Useful before a long-running call. */
export function thinkingFiller(seed: number = Date.now()): string {
  const i = Math.abs(seed) % THINKING_FILLERS.length;
  return THINKING_FILLERS[i] ?? 'Let me think.';
}

export function ackFiller(seed: number = Date.now()): string {
  const i = Math.abs(seed) % ACK_FILLERS.length;
  return ACK_FILLERS[i] ?? 'Got it.';
}

// ============================================================
//  Speak — the public surface
// ============================================================

/**
 * Tone profile — drives prosody. Standing rule: Mörbius should sound
 * warm and caring — instructive and reassuring rather than a cold
 * TTS. The tone classifier in `packages/agents/src/tone.ts`
 * picks one of these for every utterance; if not passed, we sniff
 * for cue words in the text.
 */
export type SpeakTone =
  | 'clinical'
  | 'empathetic'
  | 'reassuring'
  | 'conversational'
  | 'delivering-hard-news'
  | 'warm-care';

export interface SpeakOptions {
  lang?: string;
  quality?: VoiceQuality;
  /** Override identity for this single call. */
  identity?: VoiceId;
  /** Tone profile · drives rate/pitch deltas + clause pause. */
  tone?: SpeakTone;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
}

/**
 * Sniff a tone from the leading text when the call site didn't pass
 * one. Keyword-based — covers 80 % of real Mörbius utterances. Falls
 * back to 'conversational' which is the neutral baseline.
 */
function sniffTone(text: string): SpeakTone {
  const t = text.toLowerCase().slice(0, 240); // first 2-3 sentences
  // Hard news first — these always trump warm phrasing.
  if (
    /\b(i'?m sorry to (?:say|tell)|unfortunately|the news isn'?t good|biopsy (?:came back|was) positive|i need you to (?:sit|hear)|this is hard|cancer|malignant|metastat|critical|life[- ]threaten|unfortunately|i wish i had better news)\b/i.test(
      t,
    )
  ) {
    return 'delivering-hard-news';
  }
  // Warm-care · warm, affectionate tone for reassurance
  if (
    /\b(you'?re doing (?:so |really |very )?well|i'?m (?:so )?proud|take a deep breath|you'?re safe|i'?m (?:right )?here|let'?s go through this together|one step at a time|gently|breathe|i hear you|you'?re not alone)\b/i.test(
      t,
    )
  ) {
    return 'warm-care';
  }
  if (
    /\b(i understand|that sounds (?:tough|hard)|it'?s ok(?:ay)? to (?:feel|be)|i'?m sorry (?:that|to hear)|i can imagine|this must be|that'?s scary)\b/i.test(
      t,
    )
  ) {
    return 'empathetic';
  }
  if (
    /\b(don'?t worry|you'?re in good hands|this is (?:very )?common|(?:very )?treatable|likely fine|nothing to worry about|good news is)\b/i.test(
      t,
    )
  ) {
    return 'reassuring';
  }
  if (
    /\b(based on|the evidence shows|differential includes|recommend|likely diagnosis|icd[- ]?10|guideline)\b/i.test(
      t,
    )
  ) {
    return 'clinical';
  }
  return 'conversational';
}

/**
 * Tone-driven prosody deltas applied on top of the identity baseline.
 * Tuned by ear:
 *   clinical             → slight pickup (clear + firm)
 *   conversational       → baseline
 *   empathetic           → slower + warmer pitch (let the patient breathe)
 *   reassuring           → slower still + slight pitch lift (softens)
 *   warm-care / love     → slowest + warmest (the "doctor at the bedside")
 *   delivering-hard-news → very slow + lower pitch (gravity)
 */
function toneDeltas(tone: SpeakTone): { rateMul: number; pitchAdd: number } {
  switch (tone) {
    // Higher-fidelity, more professional clinical tone: reads faster +
    // a touch lower — confident and crisp without losing the
    // warm-doctor floor. The empathy tones intentionally stay slow;
    // only the analytical surface speeds.
    case 'clinical':
      return { rateMul: 1.1, pitchAdd: -0.05 };
    case 'empathetic':
      return { rateMul: 0.9, pitchAdd: 0.04 };
    case 'reassuring':
      return { rateMul: 0.92, pitchAdd: 0.03 };
    case 'warm-care':
      return { rateMul: 0.86, pitchAdd: 0.05 };
    case 'delivering-hard-news':
      return { rateMul: 0.82, pitchAdd: -0.06 };
    default:
      // Conversational baseline gets a slight assertive lift so Mörbius
      // doesn't sound tentative on the demo floor.
      return { rateMul: 1.04, pitchAdd: -0.02 };
  }
}

/**
 * Speak `text` with the pinned voice + clause-by-clause prosody.
 * Cancels any in-flight speech first. Increments the speaking counter
 * for the duration so `isMorbiusSpeaking()` returns true and any
 * SpeechRecognition listeners can skip their transcripts.
 */
/**
 * Pre-speech text normalisation — turns common medical abbreviations
 * into readable forms so the TTS doesn't spell them out as "E S C"
 * when the user means "escape", or "C T" when the radiologist
 * means "C-T scan." Applied once before clause-splitting so both the
 * tone-sniffer and the prosody pipeline see the cleaned text.
 *
 * Tunes the voice toward a natural, human cadence: expands abbreviations
 * like "ESC" to "escape" and keeps a professional, expressive tone.
 */
function normaliseForSpeech(text: string): string {
  let out = text;
  // Common medical + UX abbreviations · order matters (longest first).
  // Multi-letter codes that should be SPELLED stay as-is (e.g., MRI,
  // ICU stay because patients hear them spelled). The list below is
  // for things that read better expanded.
  const replacements: Array<[RegExp, string]> = [
    // UI / system
    [/\bESC\b/g, 'escape'],
    [/\bENTER\b/g, 'enter'],
    [/\bCTRL\b/g, 'control'],
    [/\bALT\b/g, 'alt'],
    [/\bPDF\b/g, 'P-D-F'],
    [/\bAPI\b/g, 'A-P-I'],
    [/\bUI\b/g, 'U-I'],
    [/\bUX\b/g, 'U-X'],
    [/\bID\b/g, 'I-D'],
    [/\bUSMLE\b/g, 'U-S-M-L-E'],
    [/\bMedQA\b/g, 'med-Q-A'],
    [/\bPubMed\b/g, 'pub-med'],
    // Imaging
    [/\bCT\b(?!\s*scan)/g, 'C-T'],
    [/\bMRI\b/g, 'M-R-I'],
    [/\bECG\b/g, 'E-C-G'],
    [/\bEKG\b/g, 'E-K-G'],
    [/\bECHO\b/g, 'echo'],
    [/\bX-ray\b/gi, 'X-ray'],
    // Cardio + emergency
    [/\bSTEMI\b/g, 'stemmy'],
    [/\bNSTEMI\b/g, 'N-stemmy'],
    [/\bACS\b/g, 'A-C-S'],
    [/\bCAD\b/g, 'C-A-D'],
    [/\bCHF\b/g, 'C-H-F'],
    [/\bAFib\b/gi, 'A-fib'],
    [/\bDVT\b/g, 'D-V-T'],
    [/\bPE\b(?=\s+(?:diagnosis|workup|risk|rule|score))/g, 'P-E'],
    // Vitals - expand to full words so locale-dependent letter
    // pronunciation never kicks in (German voice was saying "haar"
    // for HR and "bap" for BP, etc).
    [/\bBP\b/g, 'blood pressure'],
    [/\bHR\b/g, 'heart rate'],
    [/\bSpO2\b/gi, 'oxygen level'],
    [/\bSpO₂\b/g, 'oxygen level'],
    [/\bRR\b(?=\s)/g, 'breathing rate'],
    [/\bbpm\b/g, 'beats per minute'],
    [/\bmmHg\b/gi, 'millimeters of mercury'],
    // Endocrine + metabolic
    [/\bT2DM\b/g, 'type 2 diabetes'],
    [/\bT1DM\b/g, 'type 1 diabetes'],
    [/\bA1c\b/gi, 'A-one-C'],
    [/\bDKA\b/g, 'D-K-A'],
    [/\bGFR\b/g, 'G-F-R'],
    [/\beGFR\b/g, 'E-G-F-R'],
    // Other clinical
    [/\bPCOS\b/g, 'P-C-O-S'],
    [/\bPCOD\b/g, 'P-C-O-D'],
    [/\bUTI\b/g, 'U-T-I'],
    [/\bCOPD\b/g, 'C-O-P-D'],
    [/\bICU\b/g, 'I-C-U'],
    [/\bED\b(?!\s+(?:visit|admission|workup))/g, 'E-D'],
    [/\bOR\b(?=\s+(?:room|access|delay))/g, 'O-R'],
    [/\bICD-10\b/g, 'I-C-D ten'],
    [/\bICD-11\b/g, 'I-C-D eleven'],
    [/\bSNOMED\b/g, 'snow-med'],
    [/\bFHIR\b/g, 'fire'],
    [/\bHIPAA\b/g, 'hippa'],
    // Drug-specific dosing notations
    [/\bqDay\b/gi, 'every day'],
    [/\bqHS\b/gi, 'every night'],
    [/\bBID\b/g, 'twice daily'],
    [/\bTID\b/g, 'three times daily'],
    [/\bQID\b/g, 'four times daily'],
    [/\bPRN\b/g, 'as needed'],
    [/\bIV\b(?=\s+(?:fluid|line|access|push))/g, 'I-V'],
    [/\bIM\b(?=\s+injection)/g, 'I-M'],
    [/\bSC\b(?=\s+injection)/g, 'sub-Q'],
    // Mörbius-specific
    [/\bDr\.ABC\b/g, 'doctor A-B-C'],
    [/\bM(?:ö|o)rbius\b/g, 'Morbius'],
  ];
  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, replacement);
  }
  // Number ranges read better with "to" instead of dashes:
  out = out.replace(/(\d)\s*[-–]\s*(\d)/g, '$1 to $2');
  return out;
}

export function speakWithProsody(text: string, opts: SpeakOptions = {}): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const quality = opts.quality ?? readVoiceQuality();
  if (quality === 'off') {
    opts.onEnd?.();
    return;
  }

  // Cancel + reset the speaking flag — anything previously queued is
  // now interrupted.
  window.speechSynthesis.cancel();
  speakingCount = 0;

  // Normalise the text once · "ESC" → "escape", "ECG" → "E-C-G", etc.
  // Both the tone-sniffer and the clause splitter see the cleaned form.
  const normalisedText = normaliseForSpeech(text);

  const identity = opts.identity ?? readVoiceId();
  const lang = opts.lang ?? 'en-US';
  const voice =
    identity === 'system' || quality === 'system'
      ? getPinnedVoice(lang, 'system')
      : getPinnedVoice(lang, identity);

  // Identity baseline · re-tuned for advanced TTS voices. The legacy
  // SAPI voices need a slightly slower rate to sound human; the Online
  // (Natural) voices
  // sound BETTER at near-1.0 rate (they over-emphasise consonants when
  // slowed). We detect the picked voice's name at speak-time and bump
  // the baseline up if it's a Natural / Premium variant.
  const isNaturalVoice = !!voice && /Natural|Premium|\(Enhanced\)|Online \(/i.test(voice.name);
  // Distinct tones per identity — male, female, and robotic each read
  // differently, so no two identities sound the same. Per-identity
  // baselines so even when the OS falls back to the same voice, the
  // prosody differentiates them.
  // Each identity sits at a distinct rate × pitch point:
  //
  //   male-1 (Daniel · British baritone)  → slow, deepest
  //   male-2 (Davis · American warm)      → mid-pace, mid-low
  //   male-3 (Guy · American neutral)     → faster, lighter
  //   female-1 (Aria · soft)              → slow, highest
  //   female-2 (Jenny · clinical)         → faster, mid-high
  //   female-3 (Samantha · warm)          → mid, warm-high
  //   robo-1 (Synth-A · slow)             → slowest, lowest
  //   robo-2 (Synth-B · fast)             → fastest, robot-mid
  // A single warm-doctor tone for everyone — one prosody profile,
  // slightly slow + slightly warm pitch. The only difference between
  // identities is the underlying OS voice family (male/female/system).
  const WARM_DOCTOR_PROSODY = { rate: 0.95, pitch: 1.0 };
  const baseline =
    identity === 'female-1'
      ? { rate: 0.95, pitch: 1.06 }
      : identity === 'male-1'
        ? { rate: 0.93, pitch: 0.92 }
        : WARM_DOCTOR_PROSODY;
  // Natural voices read better at slightly faster rate — they already
  // carry the warmth so we don't need to slow them down.
  const prosodyBase = isNaturalVoice
    ? { rate: Math.min(1.1, baseline.rate + 0.05), pitch: baseline.pitch * 0.98 }
    : baseline;

  // One tone now — warm-doctor. The `tone` option still exists for
  // API compatibility, but every value resolves to the same prosody.
  const prosody = {
    rate: Math.max(0.5, Math.min(1.4, prosodyBase.rate)),
    pitch: Math.max(0.5, Math.min(1.6, prosodyBase.pitch)),
  };
  // One inter-clause pause now — warm-doctor cadence (160 ms) gives
  // the patient room to breathe between sentences without rushing.
  const basePauseMs = 160;
  // Punctuation-aware pause scale — sentence stops are full breath,
  // breath marks (em-dash · colon) are medium, commas are short.
  // A real reader rises and falls; this is what gives Mörbius
  // sentence cadence rather than flat clause-by-clause.
  const pauseScale: Record<ClausePauseKind, number> = {
    sentence: 1.4,
    breath: 0.9,
    comma: 0.55,
    none: 0,
  };

  // 'system' quality = single utterance (the historical path). Even
  // at 'system' we honour identity if the user picked one.
  if (quality === 'system') {
    const u = new SpeechSynthesisUtterance(normalisedText);
    if (lang) u.lang = lang;
    if (voice) u.voice = voice;
    u.rate = prosody.rate;
    u.pitch = prosody.pitch;
    setSpeaking(1);
    u.onstart = () => {
      spikeMouth(0.85);
      opts.onStart?.();
    };
    u.onboundary = (ev) => {
      // One spike per word; punctuation gets a smaller pulse so the
      // mouth doesn't snap on commas the way it does on syllables.
      const isWord = (ev as SpeechSynthesisEvent).name !== 'sentence';
      spikeMouth(isWord ? 0.85 : 0.4);
    };
    u.onend = () => {
      clearMouth();
      setSpeaking(-1);
      opts.onEnd?.();
    };
    u.onerror = () => {
      clearMouth();
      setSpeaking(-1);
      opts.onError?.();
    };
    window.speechSynthesis.speak(u);
    return;
  }

  // 'tuned' — speak each clause separately with punctuation-aware
  // pauses between them. The segments carry a `pause` tag (sentence /
  // breath / comma / none) so a long sentence reads with rise-fall
  // cadence rather than chopped flat reads.
  const segments = splitIntoSegments(normalisedText);
  if (segments.length === 0) {
    opts.onEnd?.();
    return;
  }

  let started = false;
  let pending = segments.length;
  setSpeaking(1);
  const finish = () => {
    pending--;
    if (pending === 0) {
      setSpeaking(-1);
      opts.onEnd?.();
    }
  };
  const speakSegmentAt = (i: number) => {
    if (i >= segments.length) return;
    const segment = segments[i];
    if (!segment || !segment.text) {
      finish();
      speakSegmentAt(i + 1);
      return;
    }
    const u = new SpeechSynthesisUtterance(segment.text);
    u.lang = lang;
    if (voice) u.voice = voice;
    u.rate = prosody.rate;
    u.pitch = prosody.pitch;
    u.volume = 1;
    u.onstart = () => {
      spikeMouth(0.85);
      if (!started) {
        started = true;
        opts.onStart?.();
      }
    };
    u.onboundary = (ev) => {
      const isWord = (ev as SpeechSynthesisEvent).name !== 'sentence';
      spikeMouth(isWord ? 0.85 : 0.4);
    };
    const pauseMs = Math.round(basePauseMs * pauseScale[segment.pause]);
    u.onend = () => {
      if (pending === 1) clearMouth();
      finish();
      if (i + 1 < segments.length) {
        window.setTimeout(() => speakSegmentAt(i + 1), pauseMs);
      }
    };
    u.onerror = () => {
      if (pending === 1) clearMouth();
      opts.onError?.();
      finish();
      if (i + 1 < segments.length) {
        window.setTimeout(() => speakSegmentAt(i + 1), pauseMs);
      }
    };
    window.speechSynthesis.speak(u);
  };
  speakSegmentAt(0);
}

/**
 * Cancel any in-flight Mörbius speech. Returns true if anything was
 * actually playing. Used by the global voice listener's "stop / pause
 * / cancel" command.
 */
export function cancelSpeech(): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  const wasSpeaking = speakingCount > 0;
  window.speechSynthesis.cancel();
  speakingCount = 0;
  clearMouth();
  for (const cb of SPEAKING_LISTENERS) cb(false);
  return wasSpeaking;
}
