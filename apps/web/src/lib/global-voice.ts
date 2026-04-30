/**
 * global-voice — app-wide voice navigation.
 *
 * Voice commands such as "Mörbius open this / open that" work from
 * any panel without having to land in /app/clinic first.
 * This module wires a continuous Web Speech API listener at the app
 * shell level. When a final transcript starts with the wake-word
 * ("mörbius" / "morbius" / "doctor"), the rest of the utterance is
 * parsed against a small command grammar and dispatched to the
 * matching action.
 *
 * Currently handled:
 *   - navigate :  "open / go to / show me <route>"
 *   - dictate  :  "ask <question>" — opens consult with the question
 *                 pre-stuffed via the same `dr-abc:pending-consult`
 *                 sessionStorage channel the symptom-checker uses.
 *   - control  :  "stop / pause / cancel" — kills the current speak
 *                 (TTS) so Mörbius can be interrupted mid-sentence.
 *   - clear    :  "clear chat / new consult" — sets a flag the clinic
 *                 page reads on its next render.
 *
 * The classifier is deterministic (substring) — no LLM round-trip,
 * works fully offline, latency is browser-bound (~250 ms after the
 * user stops talking).
 */

const WAKE_WORDS = ['mörbius', 'morbius', 'doctor', 'dr abc', 'dr.abc'];

const ROUTE_ALIASES: Record<string, string> = {
  dashboard: '/app',
  home: '/app',
  consult: '/app/consult',
  consultation: '/app/consult',
  clinic: '/app/consult',
  'case library': '/app/case-library',
  cases: '/app/case-library',
  imaging: '/app/imaging',
  scan: '/app/imaging',
  'brain map': '/app/brain',
  brain: '/app/brain',
  'neural core': '/app/neural-core',
  'neural map': '/app/neural-core',
  'dev console': '/app/dev-console',
  console: '/app/dev-console',
  developer: '/app/dev-console',
  architecture: '/app/architecture',
  'flow chart': '/app/architecture',
  wiring: '/app/architecture',
  'api keys': '/app/api-keys',
  keys: '/app/api-keys',
  records: '/app/profile',
  profile: '/app/profile',
  schedule: '/app/appointments',
  appointments: '/app/appointments',
  settings: '/app/settings',
};

export type VoiceCommand =
  | { kind: 'navigate'; path: string; label: string }
  | { kind: 'dictate'; text: string }
  | { kind: 'control'; action: 'stop' | 'pause' | 'cancel' }
  | { kind: 'clear' }
  /** Resume the most recent consult — pulls the newest consultId off
   *  the per-user IndexedDB memory and routes to /app/clinic?id=…. */
  | { kind: 'resume' }
  /** Open the recent-consults panel (dashboard with the recents
   *  surface focused). Drawer-style surface lives in app-shell. */
  | { kind: 'recents' };

/**
 * Static cheat-sheet of every voice phrase the parser recognises,
 * grouped for the in-app help panel. Keeping this next to the parser
 * means an out-of-date list is impossible — adding a new branch in
 * `parseCommand` should update this array in the same diff.
 */
export interface VoiceCommandHelpEntry {
  group: 'navigate' | 'consult' | 'continuity' | 'control';
  phrase: string;
  description: string;
}

export const VOICE_COMMANDS_HELP: VoiceCommandHelpEntry[] = [
  {
    group: 'navigate',
    phrase: 'Mörbius open <name>',
    description:
      'dashboard · consult · case library · imaging · brain map · neural core · dev console · api keys · profile · schedule · settings',
  },
  {
    group: 'consult',
    phrase: 'Mörbius ask <question>',
    description: 'opens consult with the question pre-stuffed',
  },
  {
    group: 'consult',
    phrase: 'Mörbius tell me about <topic>',
    description: 'same as "ask" — natural variant',
  },
  {
    group: 'continuity',
    phrase: 'Mörbius resume',
    description: 'continues the most recent saved consult',
  },
  {
    group: 'continuity',
    phrase: 'Mörbius show recents',
    description: 'opens the recent-consults panel',
  },
  { group: 'continuity', phrase: 'Mörbius clear chat', description: 'starts a fresh consult' },
  {
    group: 'control',
    phrase: 'Mörbius stop',
    description: 'cancels the current Mörbius reply mid-sentence',
  },
  {
    group: 'control',
    phrase: 'Mörbius pause / cancel / shut up',
    description: 'natural variants on stop',
  },
];

/**
 * Strip the wake-word from the start of a transcript. Returns the
 * remainder (lowercase, trimmed) or null if no wake-word matched.
 */
export function stripWakeWord(transcript: string): string | null {
  const lower = transcript.toLowerCase().trim();
  for (const wake of WAKE_WORDS) {
    if (lower.startsWith(wake)) {
      const rest = lower.slice(wake.length).replace(/^[\s,.:;!?\-–—]+/, '');
      return rest;
    }
  }
  return null;
}

/**
 * Parse a wake-word-stripped utterance into a VoiceCommand or null
 * if we don't understand it. The caller can show a "didn't catch
 * that" toast on null.
 */
export function parseCommand(rest: string): VoiceCommand | null {
  if (!rest) return null;
  const lower = rest.toLowerCase().trim();

  // Control verbs first — short circuits.
  if (/^(stop|pause|cancel|shut up|silence|quiet)\b/.test(lower)) {
    const m = lower.match(/^(stop|pause|cancel|shut up|silence|quiet)/);
    const verb = (m?.[1] ?? 'stop').replace(/\s+/g, '').toLowerCase();
    const action: 'stop' | 'pause' | 'cancel' =
      verb === 'pause' ? 'pause' : verb === 'cancel' ? 'cancel' : 'stop';
    return { kind: 'control', action };
  }
  if (/^(clear chat|new consult|reset chat|start over)\b/.test(lower)) {
    return { kind: 'clear' };
  }
  if (
    /^(resume|continue|resume last|continue last|continue consult|resume consult|where did i leave off)\b/.test(
      lower,
    )
  ) {
    return { kind: 'resume' };
  }
  if (/^(show recents|open recents|recent consults|history|show history)\b/.test(lower)) {
    return { kind: 'recents' };
  }

  // Navigation — "open X" / "go to X" / "show me X" / "take me to X".
  const navMatch = lower.match(/^(open|go to|show me|take me to|navigate to|switch to)\s+(.+)$/);
  if (navMatch?.[2]) {
    const target = navMatch[2]
      .trim()
      .replace(/^the\s+/, '')
      .replace(/[.!?]+$/, '');
    // Try exact alias first, then longest matching alias.
    if (ROUTE_ALIASES[target]) {
      return { kind: 'navigate', path: ROUTE_ALIASES[target], label: target };
    }
    let bestKey = '';
    for (const key of Object.keys(ROUTE_ALIASES)) {
      if (target.includes(key) && key.length > bestKey.length) bestKey = key;
    }
    if (bestKey) {
      const path = ROUTE_ALIASES[bestKey];
      if (path) return { kind: 'navigate', path, label: bestKey };
    }
  }

  // Dictation — "ask <question>" / "tell me about <topic>".
  const askMatch = lower.match(/^(ask|tell me about|what is|what's)\s+(.+)$/);
  if (askMatch?.[2]) {
    return { kind: 'dictate', text: askMatch[2].trim() };
  }

  return null;
}

export const __test = { stripWakeWord, parseCommand, ROUTE_ALIASES, WAKE_WORDS };
