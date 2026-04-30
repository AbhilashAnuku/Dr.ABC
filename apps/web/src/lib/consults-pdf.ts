import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { ConsultHistoryEntry } from './consult-history.ts';

/**
 * consults-pdf — printable summary of the user's recent consults.
 *
 * Renders the last N (default 5) consult entries as an A4 single-page
 * recap: chief complaint · top differential · confidence · specialty ·
 * model used · prescription flag · elapsed. Serves as a take-home
 * summary the patient can hand to a follow-up clinician.
 */

export interface ConsultsPdfInput {
  patientName?: string;
  consults: ConsultHistoryEntry[];
  generatedAt?: number;
}

const PAGE_W = 595.3; // A4 width
const PAGE_H = 841.9; // A4 height
const MARGIN = 48;

export async function buildConsultsPdf(input: ConsultsPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const ink = rgb(0.04, 0.09, 0.18);
  const muted = rgb(0.34, 0.42, 0.56);
  const accent = rgb(0.06, 0.71, 0.51);
  const ruleColor = rgb(0.86, 0.89, 0.94);

  // Take the most recent 5 — the consult-history is already sorted
  // newest-first by saveConsultHistory, but slice defensively.
  const items = [...input.consults].sort((a, b) => b.startedAt - a.startedAt).slice(0, 5);

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  // Header
  page.drawText('Mörbius', { x: MARGIN, y, size: 24, font: fontBold, color: ink });
  page.drawText('· consult summary · last 5', {
    x: MARGIN + 95,
    y: y + 4,
    size: 11,
    font: fontItalic,
    color: muted,
  });
  y -= 28;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.6,
    color: ruleColor,
  });
  y -= 22;

  // Patient block
  if (input.patientName) {
    page.drawText('PATIENT', { x: MARGIN, y, size: 8, font: fontBold, color: muted });
    y -= 14;
    page.drawText(input.patientName, { x: MARGIN, y, size: 14, font: fontBold, color: ink });
    y -= 24;
  }

  if (items.length === 0) {
    page.drawText('No consults on file yet.', {
      x: MARGIN,
      y,
      size: 12,
      font: fontItalic,
      color: muted,
    });
    y -= 16;
    page.drawText('Open the Consult page to start one — Mörbius will record it here.', {
      x: MARGIN,
      y,
      size: 10,
      font: fontRegular,
      color: muted,
    });
  }

  for (const c of items) {
    // Page-break if we'd overflow the bottom margin
    if (y < MARGIN + 130) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }

    const date = new Date(c.startedAt).toISOString().slice(0, 16).replace('T', ' ');
    page.drawText(`${date} UTC`, {
      x: MARGIN,
      y,
      size: 9,
      font: fontBold,
      color: muted,
    });
    if (c.prescriptionIssued) {
      page.drawText('Rx ISSUED', {
        x: PAGE_W - MARGIN - 75,
        y,
        size: 9,
        font: fontBold,
        color: accent,
      });
    }
    y -= 14;

    // Chief complaint
    const complaint = c.complaint.length > 110 ? `${c.complaint.slice(0, 107)}…` : c.complaint;
    page.drawText('Chief complaint', { x: MARGIN, y, size: 7, font: fontBold, color: muted });
    y -= 12;
    page.drawText(complaint, { x: MARGIN, y, size: 11, font: fontRegular, color: ink });
    y -= 18;

    // Top differential + confidence
    if (c.topCondition) {
      page.drawText('Top differential', { x: MARGIN, y, size: 7, font: fontBold, color: muted });
      y -= 12;
      const conf = c.topProb !== undefined ? ` (${Math.round(c.topProb * 100)}%)` : '';
      page.drawText(`${c.topCondition}${conf}`, {
        x: MARGIN,
        y,
        size: 12,
        font: fontBold,
        color: accent,
      });
      y -= 16;
    }

    // Footer row
    const meta: string[] = [];
    if (c.specialty) meta.push(c.specialty);
    if (c.modelUsed) meta.push(`model: ${c.modelUsed}`);
    if (c.elapsedSec) meta.push(`${c.elapsedSec}s`);
    if (meta.length > 0) {
      page.drawText(meta.join(' · '), {
        x: MARGIN,
        y,
        size: 9,
        font: fontItalic,
        color: muted,
      });
      y -= 14;
    }

    // Separator
    y -= 4;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.4,
      color: ruleColor,
    });
    y -= 18;
  }

  // Footer on the last page
  const generatedAt = input.generatedAt ?? Date.now();
  const stamp = new Date(generatedAt).toISOString().slice(0, 10);
  page.drawText(`Generated ${stamp} · Mörbius v0.5 · local-first`, {
    x: MARGIN,
    y: 36,
    size: 9,
    font: fontItalic,
    color: muted,
  });
  page.drawText(
    'Synthesised from on-device memory. Not a substitute for a clinician’s chart review.',
    {
      x: MARGIN,
      y: 22,
      size: 8,
      font: fontItalic,
      color: muted,
    },
  );

  return pdf.save();
}
