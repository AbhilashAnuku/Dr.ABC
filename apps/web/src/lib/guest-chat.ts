/**
 * guest-chat — pre-login conversation continuity.
 *
 * Visitors arriving on /landing can ask 2-3 turns before signing in.
 * Every turn lands here, in localStorage under `dr-abc:guest-chat`,
 * so the conversation survives the sign-in redirect. After the user
 * authenticates, AuthProvider drains this store into the per-user
 * IndexedDB memory and the clinic page resumes from the last
 * Mörbius reply — Claude / ChatGPT continuity, but on-device.
 *
 * Hard rules:
 *   · localStorage only — never POSTed anywhere until sign-in. Privacy
 *     guarantee: a visitor who never signs in leaves no trace on the
 *     server.
 *   · 3-turn cap — after the third user turn we prompt sign-in. Past
 *     that, the surface still works but new turns just append; the
 *     CTA stays visible.
 *   · 24-hour TTL — guest chats older than a day get cleared on next
 *     read so an abandoned tab does not pre-fill someone else's
 *     consult.
 */

const STORAGE_KEY = 'dr-abc:guest-chat';
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TURNS_BEFORE_LOGIN = 3;

export type GuestChatRole = 'user' | 'mörbius';

export interface GuestTurn {
  id: string;
  role: GuestChatRole;
  text: string;
  ts: number;
}

interface GuestChatStore {
  startedAt: number;
  turns: GuestTurn[];
}

function readStore(): GuestChatStore | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GuestChatStore;
    if (!parsed || typeof parsed !== 'object') return null;
    if (Date.now() - parsed.startedAt > TTL_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function writeStore(store: GuestChatStore | null): void {
  if (typeof window === 'undefined') return;
  if (store === null) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota error — drop silently rather than crash the chat.
  }
}

export function loadGuestChat(): GuestTurn[] {
  return readStore()?.turns ?? [];
}

export function appendGuestTurn(role: GuestChatRole, text: string): GuestTurn {
  const now = Date.now();
  const existing = readStore() ?? { startedAt: now, turns: [] };
  const turn: GuestTurn = {
    id: `g_${now}_${Math.floor(Math.random() * 1e6)}`,
    role,
    text,
    ts: now,
  };
  writeStore({ startedAt: existing.startedAt, turns: [...existing.turns, turn] });
  return turn;
}

export function clearGuestChat(): void {
  writeStore(null);
}

export function countGuestUserTurns(): number {
  const turns = loadGuestChat();
  return turns.filter((t) => t.role === 'user').length;
}

export function shouldPromptSignIn(): boolean {
  return countGuestUserTurns() >= MAX_TURNS_BEFORE_LOGIN;
}

/**
 * Render the guest conversation into a single prompt the clinic page
 * can replay through /orchestrate after sign-in, OR a markdown blob
 * the user can paste anywhere. The shape matches the prior-turns
 * block buildPrompt() prepends, so the cascade sees the conversation
 * as authoritative grounding context.
 */
export function guestChatToPromptBlock(): string {
  const turns = loadGuestChat();
  if (turns.length === 0) return '';
  const lines = turns.map((t) => {
    const speaker = t.role === 'user' ? 'PATIENT' : 'MÖRBIUS';
    return `${speaker}: ${t.text}`;
  });
  return `PRIOR CONVERSATION BEFORE SIGN-IN:\n${lines.join('\n\n')}`;
}

/**
 * After sign-in, AuthProvider calls this to migrate every guest turn
 * into the per-user IndexedDB memory store. Returns the number of
 * turns absorbed so the UI can show a "we kept your earlier 3
 * messages" confirmation.
 */
export async function migrateGuestChatToUserMemory(
  userId: string,
  storeFn: (entry: {
    userId: string;
    role: 'patient' | 'morbius';
    text: string;
    ts: number;
  }) => Promise<void>,
): Promise<number> {
  const turns = loadGuestChat();
  if (turns.length === 0) return 0;
  for (const t of turns) {
    try {
      await storeFn({
        userId,
        role: t.role === 'user' ? 'patient' : 'morbius',
        text: t.text,
        ts: t.ts,
      });
    } catch {
      // Per-turn failure — keep going, do not block the migration.
    }
  }
  clearGuestChat();
  return turns.length;
}
