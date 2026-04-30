import { cn } from '@dr-abc/ui';
import { motion } from 'framer-motion';
import { AlertTriangle, Download, Pill, Shield } from 'lucide-react';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * RxCard — structured prescription rendering with drug-safety warnings.
 *
 * The LLM emits a structured Rx; this card renders it with a formal
 * clinical layout + an export-PDF button. Drug-safety warnings are
 * surfaced inline next to each drug so the patient never misses an
 * allergy interaction.
 */

export interface RxLine {
  drug: string;
  dose: string;
  frequency: string;
  duration: string;
  warnings?: string[];
}

export interface RxPayload {
  diagnosis: string;
  icd10?: string;
  lines: RxLine[];
  generalWarnings?: string[];
  signedBy?: string;
  generatedAt?: number;
}

export interface RxCardProps {
  rx: RxPayload;
}

async function exportRxAsPdf(rx: RxPayload): Promise<void> {
  const pdf = await PDFDocument.create();
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const ink = rgb(0.04, 0.09, 0.18);
  const muted = rgb(0.34, 0.42, 0.56);
  const accent = rgb(0.06, 0.71, 0.51);
  const danger = rgb(0.95, 0.25, 0.36);

  const PAGE_W = 595.3;
  const PAGE_H = 841.9;
  const MARGIN = 48;
  const LINE = 13;

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const drawLine = (
    text: string,
    opts: { font?: typeof fontRegular; size?: number; color?: typeof ink } = {},
  ) => {
    const font = opts.font ?? fontRegular;
    const size = opts.size ?? 10;
    const color = opts.color ?? ink;
    if (y < MARGIN + LINE) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
    page.drawText(text, { x: MARGIN, y, size, font, color });
    y -= LINE;
  };

  drawLine('Dr·ABC · Mörbius', { font: fontBold, size: 18, color: accent });
  drawLine('Prescription · take-home recap', { font: fontItalic, size: 11, color: muted });
  y -= 8;
  drawLine(`Diagnosis: ${rx.diagnosis}${rx.icd10 ? ` (${rx.icd10})` : ''}`, {
    font: fontBold,
    size: 12,
  });
  drawLine(`Generated: ${new Date(rx.generatedAt ?? Date.now()).toLocaleString()}`, {
    font: fontItalic,
    size: 9,
    color: muted,
  });
  y -= 8;

  rx.lines.forEach((line, idx) => {
    drawLine(`${idx + 1}. ${line.drug} — ${line.dose}`, { font: fontBold, size: 12 });
    drawLine(`   ${line.frequency} · ${line.duration}`, { size: 10, color: muted });
    if (line.warnings && line.warnings.length > 0) {
      for (const w of line.warnings) {
        drawLine(`   ⚠ ${w}`, { size: 9, color: danger });
      }
    }
    y -= 4;
  });

  if (rx.generalWarnings && rx.generalWarnings.length > 0) {
    y -= 6;
    drawLine('General warnings:', { font: fontBold, size: 11, color: danger });
    for (const w of rx.generalWarnings) {
      drawLine(`• ${w}`, { size: 9, color: ink });
    }
  }

  y -= 10;
  drawLine('This is not a substitute for in-person clinician review.', {
    font: fontItalic,
    size: 9,
    color: muted,
  });
  drawLine(`Signed-off by: ${rx.signedBy ?? 'Architect (demo)'}`, {
    font: fontItalic,
    size: 9,
    color: muted,
  });

  const bytes = await pdf.save();
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `morbius-rx-${Date.now()}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function RxCard({ rx }: RxCardProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.05 }}
      className="mt-4 overflow-hidden rounded-2xl border border-app-subtle bg-app-surface-strong backdrop-blur-xl"
    >
      <header className="flex items-center justify-between gap-2 border-b border-app-subtle px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Pill className="h-4 w-4 text-bio-300" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-bio-200">
            Prescription · take-home
          </span>
        </div>
        <button
          type="button"
          onClick={() => void exportRxAsPdf(rx)}
          title="Export prescription as PDF"
          aria-label="Export prescription as PDF"
          className="inline-flex items-center gap-1.5 rounded-full border border-app-subtle bg-app-surface px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-app-muted transition hover:border-quantum-400/40 hover:text-quantum-300"
        >
          <Download className="h-3 w-3" />
          PDF
        </button>
      </header>
      <div className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-display text-base font-semibold text-app-primary">
            {rx.diagnosis}
          </span>
          {rx.icd10 && (
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
              ICD-10 · {rx.icd10}
            </span>
          )}
        </div>
        <ul className="space-y-2.5">
          {rx.lines.map((line) => (
            <li
              key={`${line.drug}-${line.dose}`}
              className="rounded-xl border border-app-subtle bg-app-surface px-3 py-2.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-sm font-semibold text-app-primary">
                  {line.drug}
                </span>
                <span className="font-mono text-xs tabular-nums text-quantum-300">{line.dose}</span>
              </div>
              <p className="mt-0.5 font-mono text-[11px] text-app-muted">
                {line.frequency} · {line.duration}
              </p>
              {line.warnings && line.warnings.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {line.warnings.map((w) => (
                    <li
                      key={w}
                      className={cn(
                        'flex items-start gap-1.5 rounded-md border border-rose-400/30 bg-rose-500/8 px-2 py-1',
                        'font-grotesk text-[11px] text-rose-200',
                      )}
                    >
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        {rx.generalWarnings && rx.generalWarnings.length > 0 && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/8 px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-amber-200">
              <Shield className="h-3 w-3" />
              General warnings
            </div>
            <ul className="space-y-0.5 font-grotesk text-[11px] leading-relaxed text-amber-100">
              {rx.generalWarnings.map((w) => (
                <li key={w}>• {w}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-app-faint">
          Not a substitute for in-person clinician review.
        </p>
      </div>
    </motion.section>
  );
}
