// Multimodal dropzone for the clinic consult.
//
// Three intake channels in one compact card:
//   1. Voice memo  — Web Speech Recognition transcribes in-browser
//   2. Lab PDF     — file.text() reads embedded text (works for
//                    text-PDFs; scanned PDFs prompt for paste)
//   3. Skin photo  — collected as filename + size; py-svc /imaging is
//                    optional and routes through the existing imaging
//                    agent (not duplicated here — this dropzone only
//                    *captures* the input; fusion happens via
//                    `buildMultimodalContext` from @dr-abc/agents)
//
// The dropzone surfaces a `MultimodalInput` to its parent. clinic.tsx
// fuses it on send + prepends the resulting `combinedContext` to the
// outgoing prompt — no extra round-trip.

import type { MultimodalInput } from '@dr-abc/agents';
import { cn } from '@dr-abc/ui';
import { FileText, Image as ImageIcon, Mic, MicOff, Paperclip, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult:
    | ((e: {
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
        resultIndex?: number;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  // biome-ignore lint/suspicious/noExplicitAny: vendor-prefixed Web Speech API
  const w = window as any;
  return (w.SpeechRecognition ??
    w.webkitSpeechRecognition ??
    null) as SpeechRecognitionConstructor | null;
}

interface Props {
  value: MultimodalInput;
  onChange: (next: MultimodalInput) => void;
  className?: string;
}

export function MultimodalDropzone({ value, onChange, className }: Props) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  // ─────────────────────────────────────────────────────────────────
  //  Voice — Web Speech Recognition
  // ─────────────────────────────────────────────────────────────────
  const startRecording = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError(t('multimodal.voiceUnsupported'));
      return;
    }
    setError(null);
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || 'en-US';
    let final = value.voiceTranscript ?? '';
    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res) continue;
        const seg = res[0].transcript;
        if (res.isFinal) {
          final = `${final} ${seg}`.trim();
        } else {
          live += seg;
        }
      }
      setInterim(live);
      onChange({ ...value, voiceTranscript: final });
    };
    r.onerror = (e) => {
      setError(`${t('multimodal.voiceErrorPrefix')} ${e.error}`);
      setRecording(false);
    };
    r.onend = () => {
      setRecording(false);
      setInterim('');
    };
    recRef.current = r;
    r.start();
    setRecording(true);
  }, [value, onChange, t]);

  const stopRecording = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
  }, []);

  useEffect(() => {
    return () => {
      recRef.current?.stop();
    };
  }, []);

  // ─────────────────────────────────────────────────────────────────
  //  PDF — extract real text via pdfjs-dist (lazy-loaded so the ~700 KB
  //        bundle only lands when the user drops a PDF).
  // ─────────────────────────────────────────────────────────────────
  const onPdfFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: NonNullable<MultimodalInput['labPdfs']> = [...(value.labPdfs ?? [])];
    for (const f of Array.from(files)) {
      if (!f.name.toLowerCase().endsWith('.pdf') && f.type !== 'application/pdf') continue;
      try {
        const text = await extractPdfText(await f.arrayBuffer());
        next.push({
          filename: f.name,
          text: text || t('multimodal.pdfScanned'),
        });
      } catch (err) {
        next.push({
          filename: f.name,
          text: t('multimodal.pdfReadError', {
            reason: err instanceof Error ? err.message : 'parse failed',
          }),
        });
      }
    }
    onChange({ ...value, labPdfs: next });
  };

  const removePdf = (filename: string) => {
    onChange({
      ...value,
      labPdfs: (value.labPdfs ?? []).filter((p) => p.filename !== filename),
    });
  };

  // ─────────────────────────────────────────────────────────────────
  //  Skin photo — POST to /api/imaging on drop. The imaging agent
  //               returns a structured report; we map its top finding
  //               into the ABCDE shape buildMultimodalContext expects.
  //               If imaging is offline (no api / no Anthropic / no
  //               py-svc), we still keep the filename so the diagnostic
  //               agent at least sees "image attached".
  // ─────────────────────────────────────────────────────────────────
  const onImageFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: NonNullable<MultimodalInput['skinImages']> = [...(value.skinImages ?? [])];
    const newlyAdded: Array<{ filename: string; base64: string; mimeType: string }> = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      if (f.size > 12 * 1024 * 1024) {
        setError(t('multimodal.imageOversize', { filename: f.name }));
        continue;
      }
      // Show the filename right away so the user sees feedback while
      // /api/imaging crunches.
      next.push({ filename: f.name });
      try {
        const base64 = await fileToBase64(f);
        const mimeType = f.type === 'image/png' || f.type === 'image/webp' ? f.type : 'image/jpeg';
        newlyAdded.push({ filename: f.name, base64, mimeType });
      } catch {
        // base64 read failed — keep filename only
      }
    }
    onChange({ ...value, skinImages: next });

    // Best-effort imaging analyse for each new file. Updates the entry
    // in-place when the report comes back so the next send picks up
    // the ABCDE finding without the user clicking anything.
    for (const img of newlyAdded) {
      try {
        const base = (import.meta.env.VITE_API_BASE_URL ?? '/api').toString();
        const res = await fetch(`${base}/imaging`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            imageBase64: img.base64,
            mimeType: img.mimeType,
            modality: 'skin-lesion',
          }),
        });
        if (!res.ok) continue;
        const json = (await res.json()) as { data?: ImagingReport };
        const finding = mapImagingReportToAbcde(json.data);
        if (!finding) continue;
        // Patch the entry in place — read current parent state via
        // closure-of-closure so we don't clobber concurrent edits.
        // (Idempotent: matches by filename.)
        onChange({
          ...value,
          skinImages: (value.skinImages ?? []).map((existing) =>
            existing.filename === img.filename ? { ...existing, finding } : existing,
          ),
        });
      } catch {
        // imaging endpoint unreachable — filename-only attach is fine
      }
    }
  };

  const removeImage = (filename: string) => {
    onChange({
      ...value,
      skinImages: (value.skinImages ?? []).filter((i) => i.filename !== filename),
    });
  };

  const clearVoice = () => {
    onChange({ ...value, voiceTranscript: undefined });
    setInterim('');
  };

  const hasAny =
    !!value.voiceTranscript ||
    (value.labPdfs?.length ?? 0) > 0 ||
    (value.skinImages?.length ?? 0) > 0;

  // Collapse the 3-column "Voice / Lab PDF / Skin Photo" block of
  // dense help-text panels into ONE row of icon-only buttons with
  // on-hover tooltips. The attachment chips render inline below the
  // icon row only when something's actually attached - silent at rest.
  const voiceTip = recording
    ? t('multimodal.voiceStop')
    : value.voiceTranscript
      ? t('multimodal.voiceLabel')
      : t('multimodal.voiceRecord');
  return (
    <div className={cn('rounded-xl border border-app-subtle bg-white/2 p-2', className)}>
      <div className="flex items-center gap-1.5">
        <Paperclip className="h-3.5 w-3.5 text-app-faint" />
        {/* Voice toggle */}
        <button
          type="button"
          onClick={recording ? stopRecording : startRecording}
          title={voiceTip}
          aria-label={voiceTip}
          aria-pressed={recording}
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors',
            recording
              ? 'border-rose-500/60 bg-rose-500/15 text-rose-300'
              : value.voiceTranscript
                ? 'border-bio-500/40 bg-bio-500/10 text-bio-300'
                : 'border-app-subtle text-app-muted hover:border-quantum-400/40 hover:bg-quantum-500/10 hover:text-quantum-300',
          )}
        >
          {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        {/* PDF attach */}
        <label
          title={t('multimodal.pdfHint')}
          className={cn(
            'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors',
            (value.labPdfs ?? []).length > 0
              ? 'border-quantum-400/40 bg-quantum-500/10 text-quantum-300'
              : 'border-app-subtle text-app-muted hover:border-quantum-400/40 hover:bg-quantum-500/10 hover:text-quantum-300',
          )}
        >
          <FileText className="h-4 w-4" />
          <input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => onPdfFiles(e.target.files)}
            aria-label={t('multimodal.pdfLabel')}
          />
        </label>
        {/* Image attach */}
        <label
          title={t('multimodal.imageHint')}
          className={cn(
            'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors',
            (value.skinImages ?? []).length > 0
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
              : 'border-app-subtle text-app-muted hover:border-amber-400/40 hover:bg-amber-500/10 hover:text-amber-300',
          )}
        >
          <ImageIcon className="h-4 w-4" />
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onImageFiles(e.target.files)}
            aria-label={t('multimodal.imageLabel')}
          />
        </label>
        {hasAny && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-bio-400/40 bg-bio-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-bio-300">
            ● {t('multimodal.attached', { count: countAttachments(value) })}
          </span>
        )}
      </div>

      {/* Attachment chips · render only when there's content to show */}
      {(value.voiceTranscript || interim) && (
        <p className="mt-2 line-clamp-2 font-sans text-[11px] leading-snug text-app-muted">
          <Mic className="mr-1 inline h-3 w-3 align-text-bottom text-bio-300" />
          {value.voiceTranscript}
          {interim && <span className="text-app-faint italic"> {interim}</span>}
        </p>
      )}
      {(value.labPdfs ?? []).length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {(value.labPdfs ?? []).map((p) => (
            <li
              key={p.filename}
              className="inline-flex items-center gap-1.5 rounded-full border border-quantum-500/40 bg-quantum-500/10 px-2 py-0.5 font-mono text-[10px] text-quantum-200"
            >
              <FileText className="h-3 w-3" />
              <span className="max-w-[160px] truncate">{p.filename}</span>
              <button
                type="button"
                onClick={() => removePdf(p.filename)}
                aria-label={t('multimodal.removeFile', { filename: p.filename })}
                className="text-app-faint transition hover:text-rose-300"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {(value.skinImages ?? []).length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {(value.skinImages ?? []).map((i) => (
            <li
              key={i.filename}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-200"
            >
              <ImageIcon className="h-3 w-3" />
              <span className="max-w-[160px] truncate">{i.filename}</span>
              <button
                type="button"
                onClick={() => removeImage(i.filename)}
                aria-label={t('multimodal.removeFile', { filename: i.filename })}
                className="text-app-faint transition hover:text-rose-300"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.voiceTranscript && (
        <button
          type="button"
          onClick={clearVoice}
          className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-app-faint transition hover:text-rose-300"
          aria-label={t('multimodal.voiceClear')}
        >
          clear voice
        </button>
      )}

      {error && (
        <div className="mt-2 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 font-mono text-[10px] text-rose-300">
          {error}
        </div>
      )}
    </div>
  );
}

function countAttachments(v: MultimodalInput): number {
  return (v.voiceTranscript ? 1 : 0) + (v.labPdfs?.length ?? 0) + (v.skinImages?.length ?? 0);
}

/**
 * Extract real text from a PDF using pdfjs-dist. Lazy-loaded — the
 * dynamic import means the ~700 KB pdfjs chunk only ships once the
 * user actually drops a PDF. Worker disabled (`disableWorker: true`)
 * so we don't have to ship a separate worker file alongside the
 * bundle; tradeoff is marginally slower extraction on large PDFs but
 * zero deploy-time configuration.
 */
async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // biome-ignore lint/suspicious/noExplicitAny: pdfjs types vary by build target
  const loadingTask = (pdfjs as any).getDocument({ data: buffer, disableWorker: true });
  const pdf = await loadingTask.promise;
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = (content.items as Array<{ str?: string }>).map((it) => it.str ?? '');
    out.push(items.join(' ').trim());
  }
  // Cap at 8k chars per PDF — buildMultimodalContext truncates each
  // PDF block at 2k, but extra runway here lets multi-page lab reports
  // surface the right section once the diagnostic agent prioritises.
  const joined = out.filter((t) => t.length > 0).join('\n\n');
  return joined.length > 8000 ? `${joined.slice(0, 8000)}…` : joined;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(',');
      resolve(idx === -1 ? result : result.slice(idx + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

interface ImagingReport {
  topFinding?: { label?: string; probability?: number; description?: string };
  findings?: Array<{ label?: string; probability?: number; description?: string }>;
  modality?: string;
  notes?: string;
}

type AbcdeFinding = NonNullable<NonNullable<MultimodalInput['skinImages']>[number]['finding']>;

/**
 * Map a generic imaging report into the ABCDE shape `buildMultimodalContext`
 * expects. The imaging agent returns structured findings; we project the
 * malignancy probability onto `malignancyConfidence` and pass through the
 * top finding's description as `notes`. If the report is empty we return
 * null and the parent keeps the filename-only attachment.
 */
function mapImagingReportToAbcde(report: ImagingReport | undefined): AbcdeFinding | null {
  if (!report) return null;
  const top = report.topFinding ?? report.findings?.[0];
  const prob = top?.probability ?? 0;
  if (prob === 0 && !top?.label) return null;
  return {
    asymmetry: 0,
    borderIrregularity: 0,
    colorVariegation: 0,
    diameterMm: 0,
    evolution: 'unknown',
    malignancyConfidence: prob,
    notes: top?.description ?? top?.label ?? report.notes ?? 'imaging report attached',
  };
}
