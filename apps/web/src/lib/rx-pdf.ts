import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * Stage-8 prescription PDF generator. Produces a real, printable A4
 * prescription that a clinic can hand the patient on the way out, NOT
 * a "save as PDF" of an HTML page (the previous renderRxHtml path was
 * a stop-gap).
 *
 * Self-contained: takes the PrescriptionInput shape and returns a raw
 * Uint8Array. The caller wraps it in a Blob + downloads it. No third
 * party deps beyond pdf-lib (~160 KB, zero further installs).
 */

export interface RxItemInput {
  drug: string;
  dose: string;
  frequency: string;
  duration: string;
  notes?: string;
}

export interface RxPatientInput {
  ageYears: string;
  sex: 'M' | 'F' | 'X';
  weightKg?: string;
  heightCm?: string;
  allergies?: string;
  currentMeds?: string;
  history?: string;
}

export interface RxDiagnosisInput {
  topCondition: string;
  topProb: number;
  modelUsed: string;
  specialty?: string;
  icd10?: string;
}

export interface PrescriptionInput {
  patient: RxPatientInput;
  diagnosis: RxDiagnosisInput | null;
  items: RxItemInput[];
  warnings: string[];
  followUp: string;
  generatedAt: number;
  clinicianApproved?: boolean;
  signedBy?: string;
  /** Optional patient-facing name (the medical record's `fullName`).
   *  Falls back to "Patient" when not set. */
  patientName?: string;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const INK = rgb(0.04, 0.09, 0.16);
const MUTE = rgb(0.39, 0.45, 0.55);
const RULE = rgb(0.79, 0.84, 0.88);
const ACCENT = rgb(0.0, 0.41, 0.65);
const WARN = rgb(0.61, 0.4, 0.04);
const WARN_BG = rgb(0.99, 0.95, 0.78);

// pdf-lib's standard fonts use WinAnsi (CP1252) encoding which CAN
// handle the umlauts (ö ü) and middle dot (·) Mörbius's house style
// uses, but CANNOT handle: → (U+2192), ✓ (U+2713), … (U+2026), and
// every other "fancy" Unicode in the Arrows / Misc Symbols blocks.
// Rather than embed a 200 KB Unicode font (bloats every saved Rx),
// sanitise the string before drawText: map problem chars to ASCII
// equivalents. Safe defaults; brand identity preserved
// (Mörbius stays Mörbius — ö is in CP1252).
const WINANSI_MAP: Record<string, string> = {
  '→': '->',
  '←': '<-',
  '↑': '^',
  '↓': 'v',
  '⇒': '=>',
  '⇐': '<=',
  '✓': 'OK',
  '✔': 'OK',
  '✗': 'X',
  '✘': 'X',
  '✦': '*',
  '✶': '*',
  '★': '*',
  '☆': '*',
  '…': '...',
  '–': '-',
  '—': '-',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '•': '·',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
};
function winAnsi(s: string | null | undefined): string {
  if (!s) return '';
  // Char-by-char walk: lookup-table for known offenders, '?' for
  // anything else above CP1252's 0xFF ceiling, passthrough for the
  // rest. Avoids embedding a literal-Unicode regex which trips up
  // some bundlers.
  let out = '';
  for (const ch of s) {
    const mapped = WINANSI_MAP[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const cp = ch.codePointAt(0) ?? 0;
    out += cp > 0xff ? '?' : ch;
  }
  return out;
}
/* removed_legacy_block_start
function _LEGACY_DROP_ME(s: string) {
  return s.replace(
    /[→←↑↓⇒⇐✓✔✗✘✦✶★☆…–—""''• 

]/g,
    (m) => WINANSI_MAP[m] ?? '?',
  );
  // Catch-all: anything still outside CP1252's range (0..255) gets
  // replaced with '?'. CP1252 IS a strict subset of Unicode 0-255
  // plus the 0x80-0x9F windows extensions; characters above 0xFF
  // generally won't render in WinAnsi.
  out = out.replace(/[^\x00-\xFF]/g, '?');
  return out;
}
removed_legacy_block_end */

/**
 * Build the PDF as a Uint8Array. Pure function — no DOM, no I/O —
 * which makes it trivially unit-testable (just check the first bytes
 * are `%PDF-` and that the page text contains the patient name).
 */
export async function buildRxPdf(rx: PrescriptionInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(winAnsi('Mörbius Prescription'));
  pdf.setAuthor(winAnsi('Dr.ABC · Mörbius'));
  pdf.setSubject(winAnsi(rx.diagnosis?.topCondition ?? 'Prescription'));
  pdf.setCreator(winAnsi('Dr.ABC Mörbius v0.2'));
  pdf.setProducer('pdf-lib');
  pdf.setCreationDate(new Date(rx.generatedAt));

  const page = pdf.addPage(A4);
  const inter = await pdf.embedFont(StandardFonts.Helvetica);
  const interBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const interItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  // Monkey-patch drawText on this page instance so every call site
  // below auto-sanitises Unicode → ASCII safe before pdf-lib hits its
  // WinAnsi-only Helvetica encoding. A stray '→' / '✓' / '…' from
  // upstream input (model output, patient input, copy-paste) would
  // otherwise throw at render time.
  const _origDrawText = page.drawText.bind(page);
  page.drawText = (text: string, opts: Parameters<typeof _origDrawText>[1]) =>
    _origDrawText(winAnsi(text), opts);

  const { width, height } = page.getSize();
  const W = width - 2 * MARGIN;
  let y = height - MARGIN;

  // ─── Letterhead ────────────────────────────────────────────────
  page.drawText('DR · ABC  ·  MÖRBIUS CLINIC', {
    x: MARGIN,
    y,
    size: 10,
    font: interBold,
    color: ACCENT,
  });
  y -= 12;
  page.drawText(
    'Mörbius is a clinical-decision support agent. Every Rx is co-signed by a clinician.',
    {
      x: MARGIN,
      y,
      size: 8,
      font: inter,
      color: MUTE,
    },
  );
  y -= 22;
  page.drawText('PRESCRIPTION', { x: MARGIN, y, size: 24, font: serifBold, color: INK });
  y -= 6;
  page.drawText(formatDate(rx.generatedAt), {
    x: MARGIN,
    y,
    size: 9,
    font: inter,
    color: MUTE,
  });
  y -= 18;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + W, y },
    thickness: 0.5,
    color: RULE,
  });
  y -= 18;

  // ─── Patient block ────────────────────────────────────────────
  page.drawText('PATIENT', { x: MARGIN, y, size: 8, font: interBold, color: MUTE });
  y -= 14;
  const pname = rx.patientName?.trim() || 'Patient (anonymous)';
  page.drawText(pname, { x: MARGIN, y, size: 14, font: interBold, color: INK });
  y -= 14;
  const demo = [
    rx.patient.ageYears && `Age ${rx.patient.ageYears}`,
    `Sex ${rx.patient.sex}`,
    rx.patient.weightKg && `${rx.patient.weightKg} kg`,
    rx.patient.heightCm && `${rx.patient.heightCm} cm`,
  ]
    .filter(Boolean)
    .join('  ·  ');
  page.drawText(demo, { x: MARGIN, y, size: 10, font: inter, color: INK });
  y -= 18;
  if (rx.patient.allergies?.trim()) {
    y = drawWrappedLine(page, `Allergies — ${rx.patient.allergies}`, MARGIN, y, W, inter, 9, MUTE);
    y -= 4;
  }
  if (rx.patient.currentMeds?.trim()) {
    y = drawWrappedLine(
      page,
      `Current meds — ${rx.patient.currentMeds}`,
      MARGIN,
      y,
      W,
      inter,
      9,
      MUTE,
    );
    y -= 4;
  }
  if (rx.patient.history?.trim()) {
    y = drawWrappedLine(page, `History — ${rx.patient.history}`, MARGIN, y, W, inter, 9, MUTE);
  }
  y -= 14;

  // ─── Diagnosis ────────────────────────────────────────────────
  if (rx.diagnosis) {
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + W, y },
      thickness: 0.5,
      color: RULE,
    });
    y -= 18;
    page.drawText('DIAGNOSIS', { x: MARGIN, y, size: 8, font: interBold, color: MUTE });
    y -= 14;
    const conf = `${Math.round(rx.diagnosis.topProb * 100)}% confidence`;
    page.drawText(rx.diagnosis.topCondition, {
      x: MARGIN,
      y,
      size: 13,
      font: interBold,
      color: INK,
    });
    y -= 14;
    const meta = [
      rx.diagnosis.icd10 && `ICD-10 ${rx.diagnosis.icd10}`,
      rx.diagnosis.specialty,
      conf,
      `model ${rx.diagnosis.modelUsed}`,
    ]
      .filter(Boolean)
      .join('  ·  ');
    page.drawText(meta, { x: MARGIN, y, size: 9, font: interItalic, color: MUTE });
    y -= 20;
  }

  // ─── Rx items table ──────────────────────────────────────────
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + W, y },
    thickness: 0.5,
    color: RULE,
  });
  y -= 18;
  page.drawText('Rx', { x: MARGIN, y, size: 18, font: serifBold, color: ACCENT });
  page.drawText(`${rx.items.length} item(s)`, {
    x: MARGIN + 30,
    y: y + 4,
    size: 9,
    font: inter,
    color: MUTE,
  });
  y -= 16;
  // Column header row
  const colDrug = MARGIN;
  const colDose = MARGIN + 230;
  const colFreq = MARGIN + 320;
  const colDur = MARGIN + 420;
  page.drawText('drug', { x: colDrug, y, size: 8, font: interBold, color: MUTE });
  page.drawText('dose', { x: colDose, y, size: 8, font: interBold, color: MUTE });
  page.drawText('frequency', { x: colFreq, y, size: 8, font: interBold, color: MUTE });
  page.drawText('duration', { x: colDur, y, size: 8, font: interBold, color: MUTE });
  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + W, y },
    thickness: 0.4,
    color: RULE,
  });
  y -= 12;
  for (const it of rx.items) {
    page.drawText(it.drug, { x: colDrug, y, size: 11, font: interBold, color: INK });
    page.drawText(it.dose, { x: colDose, y, size: 10, font: inter, color: INK });
    page.drawText(it.frequency, { x: colFreq, y, size: 10, font: inter, color: INK });
    page.drawText(it.duration, { x: colDur, y, size: 10, font: inter, color: INK });
    if (it.notes?.trim()) {
      y -= 11;
      page.drawText(it.notes, { x: colDrug + 12, y, size: 9, font: interItalic, color: MUTE });
    }
    y -= 16;
  }
  if (rx.items.length === 0) {
    page.drawText(
      'No standing-order Rx items matched. Specialist review required before any item is dispensed.',
      { x: MARGIN, y, size: 10, font: interItalic, color: MUTE },
    );
    y -= 14;
  }

  // ─── Warnings ────────────────────────────────────────────────
  if (rx.warnings.length > 0) {
    y -= 8;
    const warnH = 18 + rx.warnings.length * 13;
    page.drawRectangle({
      x: MARGIN,
      y: y - warnH + 14,
      width: W,
      height: warnH,
      color: WARN_BG,
      borderColor: WARN,
      borderWidth: 0.6,
    });
    page.drawText('WARNINGS', {
      x: MARGIN + 10,
      y,
      size: 8,
      font: interBold,
      color: WARN,
    });
    y -= 14;
    for (const w of rx.warnings) {
      page.drawText(`•  ${w}`, { x: MARGIN + 10, y, size: 9, font: inter, color: INK });
      y -= 13;
    }
    y -= 6;
  }

  // ─── Follow-up ──────────────────────────────────────────────
  y -= 8;
  page.drawText('FOLLOW-UP', { x: MARGIN, y, size: 8, font: interBold, color: MUTE });
  y -= 12;
  y = drawWrappedLine(page, rx.followUp, MARGIN, y, W, inter, 10, INK);
  y -= 16;

  // ─── Signature line ─────────────────────────────────────────
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: MARGIN + W, y },
    thickness: 0.5,
    color: RULE,
  });
  y -= 14;
  if (rx.clinicianApproved && rx.signedBy) {
    page.drawText(`Signed off · ${rx.signedBy}`, {
      x: MARGIN,
      y,
      size: 10,
      font: interBold,
      color: ACCENT,
    });
  } else {
    page.drawText('Pending clinician sign-off — not valid for dispense.', {
      x: MARGIN,
      y,
      size: 10,
      font: interBold,
      color: WARN,
    });
  }
  y -= 12;
  page.drawText(`Generated ${formatDate(rx.generatedAt)} by Mörbius (Dr.ABC)`, {
    x: MARGIN,
    y,
    size: 8,
    font: inter,
    color: MUTE,
  });

  // ─── Footer ─────────────────────────────────────────────────
  page.drawText(
    'Mörbius is a clinical-decision-support agent. This document does not replace in-person clinical judgement.',
    {
      x: MARGIN,
      y: MARGIN - 10,
      size: 7,
      font: interItalic,
      color: MUTE,
    },
  );

  return pdf.save();
}

// ─── helpers ──────────────────────────────────────────────────────

function formatDate(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

/**
 * Draw a string with crude word-wrapping. Returns the y-coordinate
 * AFTER the last line so the caller can keep stacking content.
 * pdf-lib has no built-in text-flow primitive so we hand-measure.
 */
function drawWrappedLine(
  page: ReturnType<PDFDocument['addPage']>,
  text: string,
  x: number,
  startY: number,
  maxWidth: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  size: number,
  color: ReturnType<typeof rgb>,
): number {
  const words = text.split(/\s+/);
  let line = '';
  let y = startY;
  for (const w of words) {
    const tentative = line ? `${line} ${w}` : w;
    const width = font.widthOfTextAtSize(tentative, size);
    if (width > maxWidth && line) {
      page.drawText(line, { x, y, size, font, color });
      y -= size + 2;
      line = w;
    } else {
      line = tentative;
    }
  }
  if (line) {
    page.drawText(line, { x, y, size, font, color });
  }
  return y;
}
