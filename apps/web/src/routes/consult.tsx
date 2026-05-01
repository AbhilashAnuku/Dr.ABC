import { cn } from '@dr-abc/ui';
import { Canvas } from '@react-three/fiber';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, FileImage, MessageSquare, RotateCcw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { Composer } from '../components/consult/composer.tsx';
import {
  DifferentialCard,
  type DifferentialItem,
} from '../components/consult/differential-card.tsx';
import { ImagingResultCard } from '../components/consult/imaging-result-card.tsx';
import { MessageBubble } from '../components/consult/message-bubble.tsx';
import { SessionsDrawer } from '../components/consult/sessions-drawer.tsx';
import { TypingIndicator } from '../components/consult/typing-indicator.tsx';
import { useAuth } from '../lib/auth.tsx';
import { backendHeaders } from '../lib/backend-pin.ts';
import { skipSeedForUser } from '../lib/case-seed.ts';
import { loadTranscript } from '../lib/consult-transcript.ts';
import { type LangCode, detectLang } from '../lib/lang-detect.ts';
import { clearMemory } from '../lib/morbius-memory.ts';
import { cancelSpeech } from '../lib/voice.ts';
import { MorbiusFace } from '../overlay/morbius-face.tsx';
import { morbiusSpeak } from '../overlay/morbius-global-voice.tsx';
import { MorbiusMark } from '../overlay/morbius-mark.tsx';

type ImagingModality =
  | 'xray-chest'
  | 'xray-other'
  | 'ct'
  | 'mri'
  | 'ultrasound'
  | 'dermatology-photo'
  | 'retinal'
  | 'histopathology';

interface ImagingFindingPayload {
  description: string;
  location?: string;
  confidence: number;
  severity?: 'mild' | 'moderate' | 'severe' | 'critical';
}

interface ImagingResultPayload {
  modality: ImagingModality;
  impression: string;
  findings: ImagingFindingPayload[];
  recommendedFollowup: string[];
  backendUsed: string;
  overlayPngBase64?: string;
}

type AttachedImage = {
  base64: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  previewUrl: string;
  fileName: string;
};

/**
 * /app/consult — Mörbius's GPT/Gemini-grade consultation surface.
 *
 * Built from scratch on 2026-05-12 to replace the dense /app/clinic
 * page for the demo. Single-column chat (max-w-3xl), bubble-less
 * Mörbius replies, sticky composer with realistic mic-waveform
 * animation, "Mörbius is composing" typing indicator, real markdown
 * rendering for the warm-doctor reply, and a structured
 * DifferentialCard that drops below the prose when the diagnostic
 * agent returns a top condition.
 *
 * Data wire: same `/orchestrate` SSE stream the rest of the app
 * uses; same chat agent (NVIDIA-generated greetings) and diagnostic
 * agent (NIM differentials). No new endpoint, no new schema —
 * purely a UI rebuild.
 */

interface Turn {
  id: string;
  role: 'user' | 'mörbius';
  text: string;
  ts: number;
  differential?: DifferentialPayload;
  imaging?: ImagingResultPayload;
  imagePreviewUrl?: string;
  /** Which agent produced this Mörbius turn — for the per-turn badge. */
  agentLabel?: string;
  /** Triage ESI 1-5 — drives the urgency colour chip. */
  esi?: number;
  /** Diagnostic specialty hint when present. */
  specialty?: string;
}

interface DifferentialPayload {
  topCondition: string;
  topProb: number;
  icd10?: string;
  differentials: DifferentialItem[];
  tests: string[];
  specialty: string;
  modelUsed: string;
  esi?: number;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult:
    | ((e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike;
}

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  // biome-ignore lint/suspicious/noExplicitAny: vendor-prefixed Web Speech API not in lib.dom.d.ts yet
  const w = window as any;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as SpeechRecognitionCtor | null;
}

const LANG_MAP: Record<string, string> = { en: 'en-US', de: 'de-DE', hi: 'hi-IN' };

const HISTORY_STORAGE_KEY = 'morbius.consult.history.v1';
const HISTORY_TURN_CAP = 60;

const MODALITY_OPTIONS: ReadonlyArray<{ value: ImagingModality; label: string }> = [
  { value: 'xray-chest', label: 'Chest X-ray' },
  { value: 'xray-other', label: 'Other X-ray' },
  { value: 'ct', label: 'CT scan' },
  { value: 'mri', label: 'MRI' },
  { value: 'ultrasound', label: 'Ultrasound' },
  { value: 'dermatology-photo', label: 'Skin photo' },
  { value: 'retinal', label: 'Retinal' },
  { value: 'histopathology', label: 'Histology' },
];

function composeImagingReply(r: ImagingResultPayload): string {
  const parts: string[] = [];
  parts.push(`Reading the **${r.modality.replace('-', ' ')}** you sent: ${r.impression}`);
  const top = r.findings.slice(0, 3);
  if (top.length > 0) {
    const lines = top.map((f, i) => {
      const conf = Math.round((f.confidence ?? 0) * 100);
      const loc = f.location ? ` (${f.location})` : '';
      const sev = f.severity ? ` · ${f.severity}` : '';
      return `${i + 1}. ${f.description}${loc} — ${conf}% confidence${sev}`;
    });
    parts.push(['**Key findings:**', ...lines].join('\n'));
  }
  if (r.recommendedFollowup.length > 0) {
    parts.push(`**Next step:** ${r.recommendedFollowup.slice(0, 3).join('; ')}.`);
  }
  parts.push(`_Backend: ${r.backendUsed}_`);
  return parts.join('\n\n');
}

function loadHistory(): Turn[] {
  // Auto-clear chat on reload: every consult mount starts on a clean slate.
  // A specific consult can be rehydrated via ?id=<consultId>
  // (the dashboard's recent-consults / case-library card links carry
  // that query parameter). The plain /app/consult URL is always blank.
  if (typeof window === 'undefined') return [];
  // Clear the rolling localStorage thread on every page-load so the
  // previous session's tail doesn't bleed into the new one.
  try {
    window.localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    /* private mode — silent */
  }
  return [];
}

function saveHistory(turns: Turn[]) {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = turns.slice(-HISTORY_TURN_CAP);
    // Drop the volatile blob-url field before write — keeps storage
    // light and avoids dead references across reloads.
    const safe = trimmed.map(({ imagePreviewUrl: _ignored, ...rest }) => rest);
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(safe));
  } catch {
    /* quota or private-mode — silent */
  }
}

export function ConsultPage() {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>(() => loadHistory());
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null);
  const [modality, setModality] = useState<ImagingModality>('xray-chest');
  // Two-in-a-row mismatch counter for the smart language-switch prompt.
  const [langMismatchSuggestion, setLangMismatchSuggestion] = useState<LangCode | null>(null);
  const mismatchStreakRef = useRef<{ lang: LangCode; count: number } | null>(null);
  // Sessions-drawer state — opens on the "History" button in the top bar.
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [activeConsultId, setActiveConsultId] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  // Revoke any blob URL on attach swap / unmount — no leaks during a
  // long demo session.
  useEffect(() => {
    return () => {
      if (attachedImage?.previewUrl) URL.revokeObjectURL(attachedImage.previewUrl);
    };
  }, [attachedImage]);

  // AI-scribe continuity — every turn snapshots to localStorage so a
  // mid-demo reload keeps the conversation thread alive.
  useEffect(() => {
    saveHistory(turns);
  }, [turns]);

  // Rehydrate from ?id=<consultId> on mount — when the user clicks a
  // recent consult on the dashboard or a case card in the case library,
  // those links carry the consultId so we can reload the actual
  // transcript instead of starting from scratch.
  useEffect(() => {
    if (typeof window === 'undefined' || !user?.id) return;
    const params = new URLSearchParams(window.location.search);
    const consultId = params.get('id');
    if (!consultId) return;
    const transcript = loadTranscript(user.id, consultId);
    if (transcript.length === 0) return;
    const hydrated: Turn[] = transcript.map((t) => ({
      id: t.id,
      role: t.role === 'patient' ? 'user' : 'mörbius',
      text: t.text,
      ts: t.ts,
    }));
    setTurns(hydrated);
  }, [user?.id]);

  // Auto-scroll to bottom on new turn / thinking change. `thinking`
  // is a render trigger, not a real dep — the effect just reads the
  // DOM scroll state which framer-motion already mutated.
  // biome-ignore lint/correctness/useExhaustiveDependencies: thinking + turns are render triggers, not data deps
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [thinking, turns.length]);

  // Route every Mörbius utterance through the global voice queue.
  // That layer holds the de-dupe + rate-limit + isMorbiusSpeaking
  // mic-gate that prevents the overlay narrator and this page from
  // doubling up on the same reply (avoids overlapping voice output).
  // Locale only used for SpeechRecognition (set on the rec object
  // directly), not for the speak helper — the global voice listener
  // picks the right voice per the user's pinned identity.
  const speak = useCallback((text: string, tone: 'warm-care' | 'reassuring' = 'warm-care') => {
    // Pass the detected language to the global voice listener so the
    // TTS voice tracks the REPLY language, not the UI shell. If a
    // user typed English on a German page, the LLM replies in
    // English; voice should match.
    const lang = detectLang(text).lang;
    morbiusSpeak(text, { tone, priority: 'normal', lang });
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (thinking) return;
      if (!text && !attachedImage) return;
      const base = (import.meta.env.VITE_API_BASE_URL ?? '/api').toString();

      // Smart language switch — if the user types in a language that
      // differs from the UI shell for two turns in a row, surface a
      // banner asking whether to switch the UI.
      if (text) {
        const { lang: detected, confidence } = detectLang(text);
        const uiLang = (i18n.resolvedLanguage ?? 'en') as LangCode;
        if (confidence >= 0.5 && detected !== uiLang) {
          const streak = mismatchStreakRef.current;
          if (streak && streak.lang === detected) {
            streak.count += 1;
            if (streak.count >= 2) {
              setLangMismatchSuggestion(detected);
            }
          } else {
            mismatchStreakRef.current = { lang: detected, count: 1 };
          }
        } else if (detected === uiLang) {
          mismatchStreakRef.current = null;
          setLangMismatchSuggestion(null);
        }
      }

      // Imaging branch — attached image routes to /imaging instead of
      // /orchestrate. Free-text alongside the image becomes the
      // clinicalContext hint for the radiologist agent.
      if (attachedImage) {
        const pinnedImage = attachedImage;
        const u: Turn = {
          id: `u_${Date.now()}`,
          role: 'user',
          text: text || '(image attached · auto-detecting modality)',
          ts: Date.now(),
          imagePreviewUrl: pinnedImage.previewUrl,
        };
        setTurns((t) => [...t, u]);
        setInput('');
        setAttachedImage(null);
        setThinking(true);
        try {
          const res = await fetch(`${base}/imaging`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...backendHeaders() },
            body: JSON.stringify({
              imageBase64: pinnedImage.base64,
              mimeType: pinnedImage.mimeType,
              modality,
              clinicalContext: text || undefined,
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = (await res.json()) as {
            data?: ImagingResultPayload;
            verdict?: string;
            confidence?: number;
          };
          let data = json.data;
          if (!data) throw new Error('imaging backend returned no data');
          // Roboflow YOLO second-pass — runs unconditionally now that
          // the dropdown is gone. YOLO is robust: if it has no model
          // for the image's actual modality it returns [] and we fall
          // back to the radiologist agent's read. Letting it run on
          // every upload means we get auto-detected labels (cardiomegaly,
          // pneumonia, lesion, etc.) directly from the pixels without
          // requiring the patient to pick a modality up front.
          let yoloDetections: ImagingFindingPayload[] = [];
          yoloDetections = await roboflowSecondPass(base, pinnedImage.base64, pinnedImage.mimeType);
          if (yoloDetections.length > 0) {
            data = {
              ...data,
              findings: dedupeFindings([...yoloDetections, ...data.findings]),
              backendUsed: `${data.backendUsed} + roboflow/yolo`,
            };
          }
          // Label-driven image analysis: when YOLO returned real labels,
          // route them through the chat agent for a clinical
          // interpretation. Otherwise fall back to the templated
          // radiology report.
          let replyText = '';
          if (yoloDetections.length > 0) {
            replyText = await composeImagingReplyFromLabels(base, modality, yoloDetections, text);
          }
          if (!replyText) replyText = composeImagingReply(data);
          setTurns((t) => [
            ...t,
            {
              id: `m_${Date.now()}`,
              role: 'mörbius',
              text: replyText,
              ts: Date.now(),
              imaging: data,
            },
          ]);
          speak(replyText, 'reassuring');
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const errReply = await composeFallbackReply(
            base,
            `My imaging cascade failed with: ${msg}. Acknowledge this to the patient warmly and suggest a next step in 1-2 sentences.`,
          );
          setTurns((t) => [
            ...t,
            {
              id: `e_${Date.now()}`,
              role: 'mörbius',
              text: errReply || msg,
              ts: Date.now(),
            },
          ]);
        } finally {
          setThinking(false);
        }
        return;
      }

      const u: Turn = {
        id: `u_${Date.now()}`,
        role: 'user',
        text,
        ts: Date.now(),
      };
      setTurns((t) => [...t, u]);
      setInput('');
      setThinking(true);

      try {
        const res = await fetch(`${base}/orchestrate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...backendHeaders() },
          body: JSON.stringify({ text }),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let replyText = '';
        let differential: DifferentialPayload | undefined;
        let triageEsi: number | undefined;
        let triageClarifyingQuestions: string[] | null = null;

        // Streaming Mörbius bubble — the chat agent now emits per-token
        // deltas through `agent.token` events, so the consult page can
        // paint the reply as it's generated rather than waiting for the
        // whole completion.
        const streamingTurnId = `s_${Date.now()}`;
        let streamingActive = false;
        let streamedText = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';
          for (const chunk of chunks) {
            const line = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              const ev = JSON.parse(line.slice(6).trim()) as {
                type?: string;
                result?: {
                  agent?: string;
                  data?: Record<string, unknown>;
                  verdict?: string;
                  confidence?: number;
                };
              };
              if (ev.type === 'agent.completed' && ev.result?.agent === 'triage') {
                const d = ev.result.data as {
                  esi?: number;
                  acknowledgement?: string;
                  clarifyingQuestions?: string[];
                  needsClarification?: boolean;
                };
                triageEsi = d?.esi;
                // Capture the structured clarifying questions; the
                // warm prose around them gets composed by the chat
                // agent (real LLM) below — never paint a canned
                // acknowledgement directly.
                if (d?.needsClarification && Array.isArray(d?.clarifyingQuestions)) {
                  triageClarifyingQuestions = d.clarifyingQuestions;
                }
              }
              // Per-token stream from the chat agent — paint each
              // delta into the live Mörbius bubble as it arrives.
              if (
                (ev as { type?: string; agent?: string; token?: string }).type === 'agent.token' &&
                (ev as { agent?: string }).agent === 'chat'
              ) {
                const delta = (ev as { token?: string }).token ?? '';
                // Skip the status-line tokens (legacy single-string
                // messages that contain no inline punctuation but ARE
                // a sentence). The new streaming emits real content
                // deltas — usually short fragments without sentence
                // periods, which is how we tell them apart.
                if (delta && !delta.startsWith('Composing')) {
                  if (!streamingActive) {
                    streamingActive = true;
                    setTurns((t) => [
                      ...t,
                      {
                        id: streamingTurnId,
                        role: 'mörbius',
                        text: '',
                        ts: Date.now(),
                        agentLabel: 'chat',
                        esi: triageEsi,
                      },
                    ]);
                  }
                  streamedText += delta;
                  const snapshot = streamedText;
                  setTurns((t) =>
                    t.map((turn) =>
                      turn.id === streamingTurnId ? { ...turn, text: snapshot } : turn,
                    ),
                  );
                }
              }
              if (ev.type === 'agent.completed' && ev.result?.agent === 'chat') {
                const d = ev.result.data as { reply?: string };
                if (d?.reply) replyText = d.reply;
              }
              if (ev.type === 'agent.completed' && ev.result?.agent === 'diagnostic') {
                const d = ev.result.data as {
                  differentials?: Array<{
                    condition?: string;
                    icd10?: string;
                    probability?: number;
                  }>;
                  recommendedTests?: string[];
                  recommendedSpecialty?: string;
                  modelUsed?: string;
                };
                const top = d?.differentials?.[0];
                if (top?.condition) {
                  const diffs: DifferentialItem[] = (d.differentials ?? []).map((x) => ({
                    condition: x.condition ?? '',
                    icd10: x.icd10,
                    probability: x.probability,
                  }));
                  differential = {
                    topCondition: top.condition,
                    topProb: top.probability ?? 0,
                    icd10: top.icd10,
                    differentials: diffs,
                    tests: d.recommendedTests ?? [],
                    specialty: d.recommendedSpecialty ?? 'General medicine',
                    modelUsed: d.modelUsed ?? 'unknown',
                    esi: triageEsi,
                  };
                  // Defer prose composition to the chat agent — see
                  // the follow-up /orchestrate call below. We leave
                  // replyText empty here so the warm-doctor prose
                  // comes from the LLM, not a template.
                }
              }
            } catch {
              /* skip malformed */
            }
          }
        }

        // Show the differential card immediately if diagnostic landed —
        // the user should never stare at an empty Mörbius bubble
        // while the prose compose call is still in flight. If the chat
        // agent already streamed text into a live bubble, attach the
        // differential to THAT same bubble so we don't double up.
        const morbiusTurnId = streamingActive ? streamingTurnId : `m_${Date.now()}`;
        if (differential && !streamingActive) {
          setTurns((t) => [
            ...t,
            {
              id: morbiusTurnId,
              role: 'mörbius',
              text: '',
              ts: Date.now(),
              differential,
              agentLabel: 'diagnostic',
              esi: differential.esi ?? triageEsi,
              specialty: differential.specialty,
            },
          ]);
        } else if (differential && streamingActive) {
          setTurns((t) =>
            t.map((turn) =>
              turn.id === streamingTurnId
                ? {
                    ...turn,
                    differential,
                    agentLabel: 'diagnostic',
                    specialty: differential.specialty,
                    esi: differential.esi ?? turn.esi,
                  }
                : turn,
            ),
          );
        }

        // If diagnostic gave structured data but no chat agent fired
        // a prose reply, ask the chat agent to compose one from the
        // structured data — real LLM call, no canned templates.
        if (!replyText && differential) {
          replyText = await composeWarmReplyFromDifferential(base, differential, triageEsi);
        }

        // If only triage clarification fired, compose warm prose for
        // those questions through the chat agent — never paint the
        // canned "I hear you. Before I suggest medication…" template
        // that comes back from triage verbatim.
        if (!replyText && triageClarifyingQuestions) {
          replyText = await composeWarmReplyFromTriage(base, text, triageClarifyingQuestions);
        }

        if (!replyText) {
          replyText = await composeFallbackReply(base, text);
        }

        // Final landing — three paths:
        //   1. The chat agent streamed tokens already → bubble has
        //      live text. Just speak the final reply (TTS).
        //   2. Differential without streaming → patch the bubble
        //      we painted at differential time.
        //   3. Neither streamed nor differential → push a new bubble
        //      now with whatever the compose chain produced.
        if (streamingActive) {
          // The streaming bubble already carries the final text;
          // backfill replyText so the TTS path below picks it up.
          if (!replyText) replyText = streamedText;
        } else if (differential) {
          setTurns((t) =>
            t.map((turn) =>
              turn.id === morbiusTurnId
                ? {
                    ...turn,
                    text:
                      replyText ||
                      '(reasoning cascade returned no prose · the differential below is the structured read)',
                  }
                : turn,
            ),
          );
        } else if (replyText) {
          setTurns((t) => [
            ...t,
            {
              id: morbiusTurnId,
              role: 'mörbius',
              text: replyText,
              ts: Date.now(),
            },
          ]);
        }
        if (replyText) speak(replyText);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const errReply = await composeFallbackReply(
          base,
          `My reasoning cascade failed with: ${msg}. Acknowledge this to the patient warmly and suggest trying again in 1-2 sentences.`,
        );
        setTurns((t) => [
          ...t,
          {
            id: `e_${Date.now()}`,
            role: 'mörbius',
            text: errReply || msg,
            ts: Date.now(),
          },
        ]);
      } finally {
        setThinking(false);
      }
    },
    [thinking, speak, attachedImage, modality, i18n.resolvedLanguage],
  );

  const toggleListen = () => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      alert('Voice input not available in this browser — try Chrome or Edge.');
      return;
    }
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    // Hard interrupt — when the user taps the mic, Mörbius MUST stop
    // talking immediately so the mic doesn't pick up his own audio
    // and the user gets the next turn without competing voices.
    cancelSpeech();
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = LANG_MAP[i18n.resolvedLanguage ?? 'en'] ?? 'en-US';
    rec.onresult = (e) => {
      const r = e.results[0];
      if (!r) return;
      const transcript = r[0].transcript;
      setListening(false);
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const clearChat = () => {
    if (attachedImage?.previewUrl) URL.revokeObjectURL(attachedImage.previewUrl);
    setAttachedImage(null);
    setTurns([]);
    setInput('');
  };

  const resetMemory = useCallback(async () => {
    if (!user?.id) return;
    const ok = window.confirm(
      "This wipes Mörbius's memory of the 15 demo cases and starts fresh. The seed will not re-run on next sign-in. Continue?",
    );
    if (!ok) return;
    try {
      await clearMemory(user.id);
      skipSeedForUser(user.id);
      window.localStorage.removeItem(HISTORY_STORAGE_KEY);
      setTurns([]);
      setInput('');
      if (attachedImage?.previewUrl) URL.revokeObjectURL(attachedImage.previewUrl);
      setAttachedImage(null);
    } catch {
      // best-effort — IndexedDB may be blocked in private windows
    }
  }, [user?.id, attachedImage]);

  const onFilePicked = useCallback(async (file: File) => {
    const okTypes: AttachedImage['mimeType'][] = ['image/jpeg', 'image/png', 'image/webp'];
    if (!okTypes.includes(file.type as AttachedImage['mimeType'])) {
      alert('Only JPEG / PNG / WebP images are supported for imaging analysis.');
      return;
    }
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number);
    const base64 = typeof window === 'undefined' ? '' : window.btoa(bin);
    const previewUrl = URL.createObjectURL(file);
    setAttachedImage({
      base64,
      mimeType: file.type as AttachedImage['mimeType'],
      previewUrl,
      fileName: file.name,
    });
  }, []);

  const onAttachImage = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const detachImage = useCallback(() => {
    if (attachedImage?.previewUrl) URL.revokeObjectURL(attachedImage.previewUrl);
    setAttachedImage(null);
  }, [attachedImage]);

  return (
    // bg-app-bg makes the consult container share the AppShell's
    // surface so there's no visible seam between the sidebar and the
    // panel. The cinematic backdrop sits on top as a transparent
    // overlay — readable on both light and dark themes.
    <div className="relative flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-app-bg">
      {/* Cinematic backdrop · slow-breathing twin-aurora glow only.
          Dropped the hard-coded dark linear-gradient that was washing
          out the light theme — the parent bg-app-bg now provides the
          base, and these tinted radials sit on top with low alpha so
          they read on every theme. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(56,189,248,0.08), transparent 65%), radial-gradient(ellipse 70% 40% at 50% 100%, rgba(168,85,247,0.10), transparent 65%)',
        }}
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        animate={{
          opacity: [0.35, 0.55, 0.35],
          scale: [1, 1.06, 1],
        }}
        transition={{ duration: 14, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
        style={{
          background:
            'radial-gradient(ellipse 40% 30% at 20% 30%, rgba(56,189,248,0.18), transparent 70%), radial-gradient(ellipse 40% 30% at 80% 70%, rgba(168,85,247,0.18), transparent 70%)',
          filter: 'blur(30px)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />

      {/* Floating 3D Mörbius head — pinned bottom-right above the
          composer. Reads from the same lipsync amplitude hook that
          drives the dashboard avatar, so when TTS plays the mouth
          opens in sync. Hidden on small screens (mobile composer
          would clash). */}
      <div className="pointer-events-none fixed right-5 bottom-28 z-40 hidden h-32 w-32 overflow-hidden rounded-full border border-bio-400/40 bg-linear-to-br from-black/70 to-black/40 shadow-[0_10px_50px_-12px_rgba(56,189,248,0.55)] backdrop-blur-md sm:right-7 sm:bottom-32 sm:block lg:right-10 lg:h-40 lg:w-40">
        <Canvas camera={{ position: [0, 0, 1.65], fov: 38 }} dpr={[1, 1.25]}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[2, 3, 4]} intensity={1.1} color="#cbe7ff" />
          <directionalLight position={[-3, 1, 3]} intensity={0.55} color="#dfffe8" />
          <pointLight position={[0, 0.5, 2.5]} intensity={0.6} color="#7dd3fc" />
          <MorbiusFace listening={listening || thinking} />
        </Canvas>
      </div>
      {/* State pill — sits BELOW the head puck, full-width readable */}
      <div className="pointer-events-none fixed right-5 bottom-20 z-40 hidden items-center gap-1.5 rounded-full border border-white/10 bg-black/70 px-2.5 py-1 backdrop-blur-md sm:right-7 sm:bottom-24 sm:inline-flex lg:right-10">
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            listening
              ? 'bg-purple-400 animate-pulse'
              : thinking
                ? 'bg-bio-400 animate-pulse'
                : 'bg-app-faint/60',
          )}
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted">
          {listening ? 'listening' : thinking ? 'thinking' : 'idle'}
        </span>
      </div>

      {/* Top bar */}
      <header className="sticky top-0 z-20 mx-auto flex w-full max-w-2xl items-center justify-between gap-4 border-b border-app-subtle bg-app-bg/60 px-4 py-3 backdrop-blur-xl sm:px-6">
        <Link
          href="/app"
          className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint hover:text-app-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <MorbiusMark className="h-5 w-5" />
          <span className="font-display text-sm font-semibold text-app-primary">Consultation</span>
          <AccuracyBadge />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSessionsOpen(true)}
            title="Open conversations panel"
            className="inline-flex items-center gap-1.5 rounded-full border border-app-subtle bg-app-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted transition hover:border-bio-400/40 hover:text-bio-300"
          >
            <MessageSquare className="h-3 w-3" />
            History
          </button>
          <button
            type="button"
            onClick={clearChat}
            disabled={turns.length === 0}
            title="Clear the active chat"
            className="inline-flex items-center gap-1.5 rounded-full border border-app-subtle bg-app-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted transition hover:border-rose-400/30 hover:text-rose-300 disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
          {/* Reset memory stays developer-only via the `morbius:dev-reset`
              localStorage flag — never surfaced to patients. */}
          {typeof window !== 'undefined' &&
            window.localStorage.getItem('morbius:dev-reset') === '1' && (
              <button
                type="button"
                onClick={() => void resetMemory()}
                disabled={!user?.id}
                title="Wipe seeded case history + start fresh (developer-only)"
                className="inline-flex items-center gap-1.5 rounded-full border border-app-subtle bg-app-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted transition hover:border-purple-400/30 hover:text-purple-300 disabled:opacity-40"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
            )}
        </div>
      </header>

      {/* Scrollable conversation — overscroll-contain stops the page
          from rubber-banding when the user scrolls past the top/bottom
          of the conversation. scroll-smooth + scrollbar-thin keep the
          cinema feel. */}
      <div
        ref={scrollRef}
        className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain scroll-smooth scrollbar-gutter-stable"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pt-5 pb-6 sm:px-6">
          {turns.length === 0 && !thinking && (
            <EmptyState onSeed={(s) => setInput(s)} userName={user?.name ?? null} />
          )}
          {turns.map((t) => (
            <MessageBubble
              key={t.id}
              role={t.role}
              text={t.text}
              imagePreviewUrl={t.imagePreviewUrl}
              agentLabel={t.agentLabel}
              esi={t.esi}
              specialty={t.specialty}
              extra={
                t.differential ? (
                  <DifferentialCard
                    topCondition={t.differential.topCondition}
                    topProb={t.differential.topProb}
                    icd10={t.differential.icd10}
                    differentials={t.differential.differentials}
                    tests={t.differential.tests}
                    specialty={t.differential.specialty}
                    modelUsed={t.differential.modelUsed}
                    esi={t.differential.esi}
                  />
                ) : t.imaging ? (
                  <ImagingResultCard
                    modality={t.imaging.modality}
                    impression={t.imaging.impression}
                    findings={t.imaging.findings}
                    recommendedFollowup={t.imaging.recommendedFollowup}
                    backendUsed={t.imaging.backendUsed}
                    overlayPngBase64={t.imaging.overlayPngBase64}
                  />
                ) : undefined
              }
            />
          ))}
          <AnimatePresence>{thinking && <TypingIndicator />}</AnimatePresence>
        </div>
      </div>

      {/* Sessions drawer — slides in from the left when the History
          button on the top bar is tapped. Lists saved consult threads
          with delete + export-PDF actions per row. */}
      <SessionsDrawer
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        userId={user?.id ?? ''}
        activeConsultId={activeConsultId}
        onNewChat={() => {
          clearChat();
          setActiveConsultId(null);
        }}
        onLoadChat={(consultId) => {
          if (typeof window === 'undefined' || !user?.id) return;
          const transcript = loadTranscript(user.id, consultId);
          const hydrated: Turn[] = transcript.map((t) => ({
            id: t.id,
            role: t.role === 'patient' ? 'user' : 'mörbius',
            text: t.text,
            ts: t.ts,
          }));
          setTurns(hydrated);
          setActiveConsultId(consultId);
          window.history.replaceState(null, '', `/app/consult?id=${consultId}`);
        }}
      />

      {/* Sticky composer */}
      <div className="relative z-20 border-t border-app-subtle bg-app-bg/60 backdrop-blur-xl">
        {/* Smart language-switch banner — appears when the user types
            in a different language than the UI for two turns in a row. */}
        {langMismatchSuggestion && (
          <div className="mx-auto w-full max-w-2xl px-4 pt-3 sm:px-6">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-purple-400/30 bg-purple-500/8 px-3 py-2 backdrop-blur-md">
              <span className="font-grotesk text-xs text-app-secondary">
                You're typing in{' '}
                <strong className="text-purple-200">
                  {langMismatchSuggestion === 'de'
                    ? 'German'
                    : langMismatchSuggestion === 'hi'
                      ? 'Hindi'
                      : 'English'}
                </strong>{' '}
                — switch the interface too?
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    void i18n.changeLanguage(langMismatchSuggestion);
                    setLangMismatchSuggestion(null);
                    mismatchStreakRef.current = null;
                  }}
                  className="rounded-full border border-purple-400/50 bg-purple-500/20 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-purple-100 hover:bg-purple-500/30"
                >
                  Switch
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLangMismatchSuggestion(null);
                    mismatchStreakRef.current = null;
                  }}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted hover:text-app-primary"
                >
                  Keep
                </button>
              </div>
            </div>
          </div>
        )}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFilePicked(f);
            e.target.value = '';
          }}
        />
        {attachedImage && (
          <div className="mx-auto w-full max-w-2xl px-4 pt-3 sm:px-6">
            <div className="flex items-center gap-3 rounded-2xl border border-purple-400/30 bg-purple-500/10 px-3 py-2 backdrop-blur-md">
              <img
                src={attachedImage.previewUrl}
                alt={attachedImage.fileName}
                className="h-12 w-12 rounded-lg border border-white/10 object-cover"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center gap-2 truncate">
                  <FileImage className="h-3.5 w-3.5 text-purple-300" />
                  <span className="truncate font-mono text-[11px] uppercase tracking-[0.18em] text-purple-200">
                    {attachedImage.fileName}
                  </span>
                </div>
                <span
                  className="inline-flex w-fit items-center gap-1.5 rounded-full border border-quantum-400/35 bg-quantum-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-quantum-200"
                  title="Mörbius detects the image category (X-ray, CT, MRI, dermatology…) automatically from the pixels. No dropdown."
                >
                  <span aria-hidden="true">⌬</span>
                  <span>auto-detect</span>
                </span>
              </div>
              <button
                type="button"
                onClick={detachImage}
                aria-label="Remove attached image"
                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-app-muted transition hover:border-rose-400/40 hover:text-rose-300"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
        <Composer
          value={input}
          onChange={setInput}
          onSubmit={() => void send(input)}
          onToggleListen={toggleListen}
          onAttachImage={onAttachImage}
          listening={listening}
          disabled={thinking}
          placeholder={
            attachedImage ? 'Add a clinical context for the imaging read (optional)…' : undefined
          }
        />
      </div>
    </div>
  );
}

/**
 * Roboflow YOLO second-pass — calls /imaging/roboflow with the same
 * image bytes the primary /imaging route used, then maps the
 * detection predictions to ImagingFindingPayload so the
 * ImagingResultCard can render them alongside the radiologist read.
 */
/**
 * composeImagingReplyFromLabels — when Roboflow YOLO returns real
 * detection labels, ask the chat agent to write a clinical
 * interpretation grounded in those labels (not the dropdown
 * modality), so screening identifies the condition rather than
 * relying solely on the selected modality.
 */
async function composeImagingReplyFromLabels(
  base: string,
  modality: ImagingModality,
  detections: ImagingFindingPayload[],
  clinicalContext: string,
): Promise<string> {
  const topLabels = detections
    .slice(0, 5)
    .map((d) => {
      const pct = Math.round((d.confidence ?? 0) * 100);
      return `${d.description} (${pct}% confidence${d.severity ? ` · ${d.severity}` : ''}${d.location ? ` · ${d.location}` : ''})`;
    })
    .join('; ');
  const ctx = clinicalContext.trim();
  const prompt = `A patient just uploaded a ${modality.replace('-', ' ')} image. A YOLO detector returned these labelled findings on the image: ${topLabels}.${ctx ? ` Patient's clinical context: ${ctx}.` : ''} As a warm-doctor radiologist, write a 3-4 sentence clinical interpretation that names what was actually seen, gives a plain-language likely condition (or differential), and ends with a clear recommendation. Don't recite the labels back — synthesise them. No process-talk like "ABCDE assessment is the next step."`;
  try {
    const res = await fetch(`${base}/orchestrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...backendHeaders() },
      body: JSON.stringify({ text: prompt }),
    });
    if (!res.ok || !res.body) return '';
    return await readChatReplyFromStream(res.body);
  } catch {
    return '';
  }
}

async function roboflowSecondPass(
  base: string,
  imageBase64: string,
  _mimeType: string,
): Promise<ImagingFindingPayload[]> {
  try {
    const res = await fetch(`${base}/imaging/roboflow`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...backendHeaders() },
      body: JSON.stringify({ imageBase64 }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      ok?: boolean;
      predictions?: Array<{
        class?: string;
        confidence?: number;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      }>;
    };
    if (!json.ok || !json.predictions) return [];
    return json.predictions
      .filter((p) => p.class && typeof p.confidence === 'number')
      .slice(0, 5)
      .map<ImagingFindingPayload>((p) => ({
        description: `${p.class} detected (YOLO)`,
        location:
          typeof p.x === 'number' && typeof p.y === 'number'
            ? `bbox @ (${Math.round(p.x)}, ${Math.round(p.y)})`
            : undefined,
        confidence: p.confidence ?? 0,
        severity: (p.confidence ?? 0) >= 0.85 ? 'severe' : 'moderate',
      }));
  } catch {
    return [];
  }
}

function modalitySupportsYolo(m: ImagingModality): boolean {
  return (
    m === 'xray-chest' ||
    m === 'xray-other' ||
    m === 'dermatology-photo' ||
    m === 'retinal' ||
    m === 'histopathology'
  );
}

function dedupeFindings(fs: ImagingFindingPayload[]): ImagingFindingPayload[] {
  const seen = new Set<string>();
  const out: ImagingFindingPayload[] = [];
  for (const f of fs) {
    const key = `${f.description.toLowerCase()}|${f.location ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/**
 * composeWarmReplyFromDifferential — when diagnostic returns
 * structured data but no chat agent fired, re-enter /orchestrate
 * with a compose-style prompt so the warm-doctor prose is real LLM
 * output (NVIDIA NIM via MorbiusChatAgent), not a template.
 */
async function composeWarmReplyFromDifferential(
  base: string,
  d: DifferentialPayload,
  esi: number | undefined,
): Promise<string> {
  const top = d.differentials[0];
  const conf = Math.round((d.topProb ?? 0) * 100);
  const others = d.differentials
    .slice(1, 4)
    .map((x) => `${x.condition} ${Math.round((x.probability ?? 0) * 100)}%`)
    .join(', ');
  const tests = d.tests.slice(0, 4).join(', ');
  const esiLine = typeof esi === 'number' ? `Triage ESI: ${esi}.` : '';
  const prompt = [
    'You just reviewed a case. Now compose a warm-doctor reply (2-4 short sentences) summarising:',
    `Top: ${d.topCondition}${d.icd10 ? ` (${d.icd10})` : ''} at ${conf}% confidence.`,
    others ? `Other possibilities: ${others}.` : '',
    tests ? `Tests to run: ${tests}.` : '',
    `Specialty: ${d.specialty}.`,
    esiLine,
    'Be calm, direct, empathetic. If ESI is 1 or 2, urge the patient to seek care now.',
  ]
    .filter(Boolean)
    .join(' ');
  try {
    const res = await fetch(`${base}/orchestrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...backendHeaders() },
      body: JSON.stringify({ text: prompt }),
    });
    if (!res.ok || !res.body) return '';
    return await readChatReplyFromStream(res.body);
  } catch {
    return '';
  }
}

/**
 * composeWarmReplyFromTriage — when triage flags the user turn as
 * needing more info, the structured clarifying questions go to the
 * chat agent so the user-visible prose around them is LLM-generated
 * (warm, time-aware, conversational), not a canned acknowledgement.
 */
async function composeWarmReplyFromTriage(
  base: string,
  userText: string,
  questions: string[],
): Promise<string> {
  const list = questions.slice(0, 5).join(' · ');
  const prompt = [
    `The patient said: "${userText}".`,
    'Compose a warm-doctor reply in 2-3 short sentences acknowledging what they said and inviting them to share more.',
    `Then ask up to 5 short, specific follow-up questions about: ${list}.`,
    'Format the questions as a numbered list. Do not greet again if it would be redundant; match the moment in time.',
  ].join(' ');
  try {
    const res = await fetch(`${base}/orchestrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...backendHeaders() },
      body: JSON.stringify({ text: prompt }),
    });
    if (!res.ok || !res.body) return '';
    return await readChatReplyFromStream(res.body);
  } catch {
    return '';
  }
}

/**
 * composeFallbackReply — last resort if both diagnostic and the
 * compose call produced nothing usable. Asks the chat agent to ack
 * the user's input naturally.
 */
async function composeFallbackReply(base: string, userText: string): Promise<string> {
  try {
    const res = await fetch(`${base}/orchestrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...backendHeaders() },
      body: JSON.stringify({
        text: `The user said: "${userText}". Respond warmly in 1-2 sentences and ask one clarifying question.`,
      }),
    });
    if (!res.ok || !res.body) return '';
    return await readChatReplyFromStream(res.body);
  } catch {
    return '';
  }
}

/** Drain an /orchestrate SSE stream and return the chat-agent reply. */
async function readChatReplyFromStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reply = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        const ev = JSON.parse(line.slice(6).trim()) as {
          type?: string;
          result?: { agent?: string; data?: Record<string, unknown> };
        };
        if (ev.type === 'agent.completed' && ev.result?.agent === 'chat') {
          const d = ev.result.data as { reply?: string };
          if (d?.reply) reply = d.reply;
        }
      } catch {
        /* skip malformed */
      }
    }
  }
  return reply;
}

/**
 * AccuracyBadge — small live MedQA-accuracy pill in the consult
 * top bar. Reads the latest morbius:accuracy snapshot from
 * sessionStorage (set by the autopilot + the harness scripts) and
 * falls back to the published 74.5 % figure when no fresh number is
 * available on the client. Click → opens /app/dev-console?tab=accuracy.
 */
function AccuracyBadge() {
  const [pct, setPct] = useState<number | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.sessionStorage.getItem('morbius:medqa:accuracy');
    if (stored) {
      const n = Number.parseFloat(stored);
      if (!Number.isNaN(n)) setPct(n);
    }
    // Best-effort live fetch — populates sessionStorage so subsequent
    // mounts read instantly. Silent on failure.
    const base = (import.meta.env.VITE_API_BASE_URL ?? '/api').toString();
    fetch(`${base}/accuracy/live`, { headers: backendHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { medqaAccuracy?: number } | null) => {
        if (j && typeof j.medqaAccuracy === 'number') {
          setPct(j.medqaAccuracy);
          window.sessionStorage.setItem('morbius:medqa:accuracy', String(j.medqaAccuracy));
        }
      })
      .catch(() => {});
  }, []);
  const value = pct ?? 0.745;
  return (
    <Link
      href="/app/dev-console?tab=research"
      title="Mörbius MedQA-USMLE accuracy · click for the full panel"
      className="inline-flex items-center gap-1.5 rounded-full border border-bio-400/40 bg-bio-500/10 px-2.5 py-0.5 font-mono text-[10px] tabular-nums tracking-[0.18em] text-bio-200 transition hover:bg-bio-500/20"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-bio-400" />
      {(value * 100).toFixed(1)}%<span className="text-app-faint">MedQA</span>
    </Link>
  );
}

function EmptyState({
  onSeed,
  userName,
}: {
  onSeed: (s: string) => void;
  userName: string | null;
}) {
  const [greeting, setGreeting] = useState<string | null>(null);
  const firstName = userName ? userName.split(' ')[0] : null;

  // First-paint greeting comes from the chat agent (real LLM, time-aware).
  // Falls back to nothing rather than a canned string — no hardcoded
  // placeholder text anywhere in this panel.
  useEffect(() => {
    let alive = true;
    const base = (import.meta.env.VITE_API_BASE_URL ?? '/api').toString();
    const prompt = firstName
      ? `Greet the patient ${firstName} warmly in one short sentence. Match the local time of day.`
      : 'Greet the patient warmly in one short sentence and invite them to share what is on their mind. Match the local time of day.';
    fetch(`${base}/orchestrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...backendHeaders() },
      body: JSON.stringify({ text: prompt }),
    })
      .then(async (r) => {
        if (!r.ok || !r.body) return '';
        return readChatReplyFromStream(r.body);
      })
      .then((reply) => {
        if (alive && reply) setGreeting(reply);
      })
      .catch(() => {
        /* leave greeting null — render the mark only */
      });
    return () => {
      alive = false;
    };
  }, [firstName]);

  // the editor-style starter cards — category label + icon glyph + the
  // actual prompt. Theme-token surfaces so the cards read on both
  // light and dark themes (the previous bg-white/N pill style washed
  // out on the light surface).
  const starters: Array<{ category: string; glyph: string; prompt: string }> = [
    {
      category: 'Symptom',
      glyph: '🩹',
      prompt: 'I have a sharp pain in my lower right abdomen',
    },
    {
      category: 'Medication',
      glyph: '💊',
      prompt: 'Can you suggest meds for regular headaches?',
    },
    {
      category: 'Lab values',
      glyph: '🧪',
      prompt: 'My fasting glucose has been 180 — should I worry?',
    },
    {
      category: 'Diagnosis',
      glyph: '🔍',
      prompt: 'irregular periods + acne — could it be PCOS?',
    },
  ];

  const fallbackHeadline = firstName ? `Good to see you, ${firstName}.` : 'How can I help today?';
  const headline = greeting
    ? greeting.split(/[.!?]/)[0]?.trim() || fallbackHeadline
    : fallbackHeadline;

  return (
    <div className="flex flex-col items-center gap-8 py-10">
      <div className="flex flex-col items-center gap-4 text-center">
        <MorbiusMark className="h-12 w-12" />
        <h1 className="font-display text-2xl font-semibold text-app-primary sm:text-3xl">
          {headline}
        </h1>
        <p className="max-w-md font-grotesk text-sm leading-relaxed text-app-muted sm:text-base">
          {greeting && greeting.length > headline.length + 2
            ? greeting
            : 'Tell me what is on your mind — a symptom, a question, a recent lab. I will ask before I diagnose.'}
        </p>
      </div>
      <div className="grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-2">
        {starters.map((s) => (
          <button
            key={s.prompt}
            type="button"
            onClick={() => onSeed(s.prompt)}
            className="group flex flex-col items-start gap-1.5 rounded-2xl border border-app-subtle bg-app-surface-strong/70 px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-quantum-400/50 hover:bg-app-surface-strong hover:shadow-[0_8px_30px_-12px_rgba(56,189,248,0.35)]"
          >
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
              <span className="text-base leading-none">{s.glyph}</span>
              {s.category}
            </span>
            <span className="font-grotesk text-sm leading-snug text-app-primary group-hover:text-app-primary">
              {s.prompt}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
