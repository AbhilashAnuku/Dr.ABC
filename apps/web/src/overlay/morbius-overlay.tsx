import { Button, cn } from '@dr-abc/ui';
import { Camera, Mic, MicOff, Send, Sparkles, X } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBackendStatus } from '../lib/use-backend-status.ts';
import { readTapToWakeEnabled, useTapToWake } from '../lib/use-tap-to-wake.ts';
import { speakWithProsody } from '../lib/voice.ts';
import { ImagingMaskOverlay } from './imaging-overlay.tsx';
import { MorbiusMark } from './morbius-mark.tsx';

// The 3D head + WebGL Canvas are heavy and only relevant once the chat
// overlay is open. Lazy-load so the landing/dashboard pages don't pay
// the cost (and never crash from a stray glTF fetch on first paint).
const Avatar3D = lazy(() => import('./avatar-3d.tsx'));

type ChatRole = 'user' | 'morbius';
interface ChatImaging {
  imageDataUrl: string;
  maskBase64: string;
  coverage?: number;
  caption: string;
}
interface ChatMsg {
  id: string;
  role: ChatRole;
  text: string;
  ts: number;
  imaging?: ChatImaging;
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

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  // biome-ignore lint/suspicious/noExplicitAny: vendor-prefixed Web Speech API not in lib.dom.d.ts yet
  const w = window as any;
  return (w.SpeechRecognition ??
    w.webkitSpeechRecognition ??
    null) as SpeechRecognitionConstructor | null;
}

const I18N_LANG_MAP: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  hi: 'hi-IN',
};

function inferMimeType(dataUrl: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (dataUrl.startsWith('data:image/png')) return 'image/png';
  if (dataUrl.startsWith('data:image/webp')) return 'image/webp';
  return 'image/jpeg';
}

export function MorbiusOverlay() {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const backend = useBackendStatus();
  useTapToWake({
    enabled: readTapToWakeEnabled(),
    onTap: useCallback(() => setOpen(true), []),
  });
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptListRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the chat to the latest message
  useEffect(() => {
    transcriptListRef.current?.scrollTo({ top: transcriptListRef.current.scrollHeight });
  }, []);

  const speak = useCallback(
    (text: string) => {
      speakWithProsody(text, {
        lang: I18N_LANG_MAP[i18n.resolvedLanguage ?? 'en'] ?? 'en-US',
        onStart: () => setSpeaking(true),
        onEnd: () => setSpeaking(false),
        onError: () => setSpeaking(false),
      });
    },
    [i18n.resolvedLanguage],
  );

  const send = useCallback(
    async (text: string, attachedImage?: string) => {
      if (!text.trim() && !attachedImage) return;
      const userMsg: ChatMsg = {
        id: `u_${Date.now()}`,
        role: 'user',
        text: attachedImage ? `${text || 'Analyse this image'} [image attached]` : text,
        ts: Date.now(),
      };
      setMessages((m) => [...m, userMsg]);
      setInput('');
      setThinking(true);

      // IMAGE PATH — when an image is attached, go straight to /imaging.
      // The sidecar always runs; Anthropic vision is an upgrade, not a gate.
      if (attachedImage) {
        try {
          const base = (import.meta.env.VITE_API_BASE_URL ?? '/api').toString();
          const stripped = attachedImage.includes(',')
            ? (attachedImage.split(',')[1] ?? '')
            : attachedImage;
          const mimeType = inferMimeType(attachedImage);
          const res = await fetch(`${base}/imaging`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              imageBase64: stripped,
              mimeType,
              modality: 'xray-other',
              clinicalContext: text || undefined,
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const result = (await res.json()) as {
            data?: {
              impression?: string;
              backendUsed?: string;
              overlayPngBase64?: string;
              overlayCoverage?: number;
              findings?: { description: string }[];
            };
          };
          const data = result.data ?? {};
          const finding = data.findings?.[0]?.description ?? '';
          const replyText = [
            data.impression ?? 'Image analysed.',
            finding ? `\n\n• ${finding}` : '',
            `\n\n_backend: ${data.backendUsed ?? 'unknown'}_`,
          ].join('');
          setMessages((m) => [
            ...m,
            {
              id: `m_${Date.now()}`,
              role: 'morbius',
              text: replyText,
              ts: Date.now(),
              imaging: data.overlayPngBase64
                ? {
                    imageDataUrl: attachedImage,
                    maskBase64: data.overlayPngBase64,
                    coverage: data.overlayCoverage,
                    caption: `${data.backendUsed ?? 'sidecar'} · segmentation overlay`,
                  }
                : undefined,
            },
          ]);
          speak(data.impression ?? 'Image analysed.');
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setMessages((m) => [
            ...m,
            {
              id: `e_${Date.now()}`,
              role: 'morbius',
              text: `(Imaging offline — ${msg}. Start py-svc with \`bun run infra:up\` or set ANTHROPIC_API_KEY.)`,
              ts: Date.now(),
            },
          ]);
        } finally {
          setThinking(false);
          setSnapshot(null);
        }
        return;
      }

      // Every patient turn goes through the live /orchestrate cascade.
      // The triage agent's conversational SOAP gate handles small-talk
      // and vague-exploratory inputs by emitting clarifying questions;
      // specific clinical inputs route to the diagnostic agent. The
      // local canned-Q&A intercept that used to live here was firing
      // on inputs like "hello Maurice" and returning a "Try:" suggestion
      // list instead of letting Mörbius answer, which made the overlay
      // feel disconnected from the rest of the platform.
      try {
        const base = (import.meta.env.VITE_API_BASE_URL ?? '/api').toString();
        const res = await fetch(`${base}/orchestrate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        // Read SSE events; show the validator/triage final result as Mörbius's reply
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let answer = '';
        let triageBody = '';

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
              const event = JSON.parse(line.slice(6).trim()) as {
                type?: string;
                result?: { agent?: string; data?: unknown; verdict?: string; confidence?: number };
              };
              if (event.type === 'agent.completed' && event.result?.agent === 'triage') {
                const d = event.result.data as {
                  rationale?: string;
                  esi?: number;
                  needsClarification?: boolean;
                  clarifyingQuestions?: string[];
                  acknowledgement?: string;
                };
                triageBody = d?.rationale ?? 'evaluated';
                // Conversational SOAP gate — if triage flagged the
                // input as vague / exploratory / small-talk, render
                // the warm-doctor questions verbatim instead of
                // chasing a differential that will never arrive.
                if (d?.needsClarification && Array.isArray(d.clarifyingQuestions)) {
                  const lines: string[] = [];
                  if (d.acknowledgement) lines.push(d.acknowledgement);
                  lines.push(d.clarifyingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n'));
                  lines.push(
                    "Answer as much as you're comfortable with — we'll take it step by step.",
                  );
                  answer = lines.join('\n\n');
                }
              }
              if (event.type === 'pipeline.completed' && event.result && !answer) {
                const d = event.result.data as {
                  rationale?: string;
                  differentials?: Array<{ condition: string; probability?: number }>;
                  recommendedSpecialty?: string;
                  recommendedTests?: string[];
                } | null;
                const top = d?.differentials?.[0];
                if (top) {
                  const conf = Math.round((top.probability ?? 0) * 100);
                  const tests = d?.recommendedTests?.join(', ');
                  const spec = d?.recommendedSpecialty;
                  const parts = [
                    `Putting it together, this looks most like **${top.condition}** — about ${conf}% on that.`,
                  ];
                  if (tests) parts.push(`To confirm, I'd run: ${tests}.`);
                  if (spec) parts.push(`Specialty: ${spec}.`);
                  answer = parts.join('\n\n');
                } else {
                  answer =
                    'I worked through it but the cascade did not return a confident differential this turn. Tell me a little more — when it started, how it feels, what makes it better or worse.';
                }
              }
            } catch {
              // ignore malformed
            }
          }
        }

        const reply: ChatMsg = {
          id: `m_${Date.now()}`,
          role: 'morbius',
          text:
            answer ||
            'Routed through the gauntlet — open the Consult page for the structured result.',
          ts: Date.now(),
        };
        setMessages((m) => [...m, reply]);
        speak(reply.text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setMessages((m) => [
          ...m,
          {
            id: `e_${Date.now()}`,
            role: 'morbius',
            text: `(API offline — ${msg}. Set your LLM provider key in Settings to enable Diagnostic.)`,
            ts: Date.now(),
          },
        ]);
      } finally {
        setThinking(false);
        setSnapshot(null);
      }
    },
    [speak],
  );

  const toggleListen = () => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      alert('Browser speech recognition not available — try Chrome or Edge.');
      return;
    }
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = I18N_LANG_MAP[i18n.resolvedLanguage ?? 'en'] ?? 'en-US';
    rec.onresult = (e) => {
      const r = e.results[0];
      if (!r) return;
      const transcript = r[0].transcript;
      setInput(transcript);
      setListening(false);
      void send(transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const captureSnapshot = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      // brief delay so the camera warms up
      await new Promise((r) => setTimeout(r, 300));
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      for (const track of stream.getTracks()) track.stop();
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setSnapshot(dataUrl);
      setInput('Analyse this image');
    } catch {
      alert('Camera access denied or unavailable.');
    }
  };

  return (
    <>
      {/* Floating launcher — SVG bot face, no WebGL, no glTF fetch */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open Mörbius assistant"
        className={cn(
          'fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-quantum-400/50 bg-ink-950/85 backdrop-blur-md shadow-2xl transition-all',
          'hover:scale-105 hover:border-quantum-300',
        )}
      >
        <span className="pulse-glow pointer-events-none absolute inset-0 rounded-full" />
        <MorbiusMark
          size={42}
          active={open || listening || speaking || thinking}
          listening={listening}
          speaking={speaking}
          className="relative"
        />
      </button>

      {/* Slide-in panel */}
      <aside
        className={cn(
          'fixed bottom-24 right-5 z-50 flex w-[min(380px,calc(100vw-2.5rem))] flex-col rounded-2xl border border-quantum-400/30 bg-ink-950/95 backdrop-blur-xl shadow-2xl transition-all',
          open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0',
        )}
        style={{ maxHeight: 'calc(100vh - 8rem)' }}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between border-b border-app-subtle px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-quantum-400" />
            <span className="font-display text-sm font-semibold text-app-primary">Mörbius</span>
            <span
              className={cn(
                'font-mono text-[9px] uppercase tracking-[0.18em]',
                listening ? 'text-bio-400' : speaking ? 'text-quantum-400' : 'text-app-faint',
              )}
            >
              {listening ? 'listening' : speaking ? 'speaking' : thinking ? 'thinking…' : 'idle'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded-md p-1 text-app-muted hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Backend status banner */}
        {!backend.loading && backend.backend === 'offline' && (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">
              {backend.ok
                ? 'reasoning model offline · answers limited to common conditions'
                : 'api unreachable · local Q&A only'}
            </p>
          </div>
        )}
        {!backend.loading && backend.backend !== 'offline' && (
          <div className="border-b border-app-subtle bg-bio-500/5 px-3 py-1">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-bio-400/80">
              reasoning · {backend.backend}
            </p>
          </div>
        )}

        {/* 3D face — only mounts when overlay is opened, so the WebGL
            context (and any glTF fetches) never run on landing/dashboard. */}
        <div className="flex h-44 items-center justify-center border-b border-app-subtle bg-black/40">
          {open ? (
            <Suspense
              fallback={<MorbiusMark size={120} active listening={listening} speaking={speaking} />}
            >
              <Avatar3D speaking={speaking} listening={listening} />
            </Suspense>
          ) : (
            <MorbiusMark size={120} active={false} />
          )}
        </div>

        {/* Chat transcript */}
        <div
          ref={transcriptListRef}
          className="flex-1 space-y-2 overflow-y-auto p-3"
          style={{ minHeight: 60 }}
        >
          {messages.length === 0 ? (
            <p className="font-sans text-xs text-app-faint">
              Tap the mic to talk. Tap the camera to scan. Or type your symptom below — Mörbius
              answers in {i18n.resolvedLanguage?.toUpperCase()}.
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'space-y-2 rounded-lg px-3 py-1.5 font-sans text-xs leading-relaxed',
                  m.role === 'user'
                    ? 'ml-6 bg-quantum-500/15 text-app-primary'
                    : 'mr-6 bg-bio-500/10 text-bio-200',
                )}
              >
                <p className="whitespace-pre-wrap">{m.text}</p>
                {m.imaging && (
                  <ImagingMaskOverlay
                    imageDataUrl={m.imaging.imageDataUrl}
                    maskBase64={m.imaging.maskBase64}
                    coverage={m.imaging.coverage}
                    caption={m.imaging.caption}
                  />
                )}
              </div>
            ))
          )}
          {snapshot && (
            <img src={snapshot} alt="snapshot" className="rounded-md border border-app-subtle" />
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input, snapshot ?? undefined);
          }}
          className="flex items-center gap-2 border-t border-app-subtle p-2"
        >
          <Button
            type="button"
            variant="ghost"
            onClick={toggleListen}
            aria-label={listening ? 'Stop listening' : 'Start listening'}
            className={cn(listening ? 'text-bio-400' : 'text-app-muted')}
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void captureSnapshot()}
            aria-label="Camera"
            className="text-app-muted"
          >
            <Camera className="h-4 w-4" />
          </Button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('consult.placeholder')}
            className="flex-1 rounded-lg border border-app-subtle bg-white/5 px-3 py-2 font-sans text-sm text-app-primary placeholder:text-app-faint focus:border-quantum-400/60 focus:outline-none"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={(!input.trim() && !snapshot) || thinking}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </aside>
    </>
  );
}
