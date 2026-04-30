/**
 * Per-module settings — stored locally only. The Anthropic key is the
 * one the Diagnostic + Imaging agents need; we never POST it to our own
 * server (the user's browser sends it directly to api.anthropic.com via
 * the Diagnostic Agent's V1 client-side flow, when that lands).
 *
 * For now (V0) the API key in Settings is documentation-only — the agents
 * read from `process.env.ANTHROPIC_API_KEY` on the API side. Future PR
 * threads the user-supplied key through a per-request header so each
 * user's key authorises their own consults.
 */

export interface ModuleSettings {
  anthropicApiKey: string;
  anthropicModel: string;
  anthropicVisionModel: string;
}

const STORAGE_KEY = 'dr-abc:module-settings';

const DEFAULTS: ModuleSettings = {
  anthropicApiKey: '',
  anthropicModel: 'claude-sonnet-4-6',
  anthropicVisionModel: 'claude-sonnet-4-6',
};

export function readSettings(): ModuleSettings {
  if (typeof window === 'undefined') return DEFAULTS;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULTS;
  try {
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ModuleSettings>) };
  } catch {
    return DEFAULTS;
  }
}

export function writeSettings(s: ModuleSettings): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export interface NotificationPrefs {
  appointment: { email: boolean; push: boolean; sms: boolean };
  consult: { email: boolean; push: boolean; sms: boolean };
  marketing: { email: boolean; push: boolean; sms: boolean };
}

const NOTIF_KEY = 'dr-abc:notif-prefs';
const NOTIF_DEFAULTS: NotificationPrefs = {
  appointment: { email: true, push: true, sms: false },
  consult: { email: true, push: true, sms: false },
  marketing: { email: false, push: false, sms: false },
};

export function readNotifPrefs(): NotificationPrefs {
  if (typeof window === 'undefined') return NOTIF_DEFAULTS;
  const raw = window.localStorage.getItem(NOTIF_KEY);
  if (!raw) return NOTIF_DEFAULTS;
  try {
    return { ...NOTIF_DEFAULTS, ...(JSON.parse(raw) as Partial<NotificationPrefs>) };
  } catch {
    return NOTIF_DEFAULTS;
  }
}

export function writeNotifPrefs(p: NotificationPrefs): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(NOTIF_KEY, JSON.stringify(p));
}
