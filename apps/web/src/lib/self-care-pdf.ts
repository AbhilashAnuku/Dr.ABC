import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * self-care-pdf — printable card for casual-mode replies.
 *
 * The "casual" chat mode (clinic.tsx) ends every Mörbius reply with
 * "Save this card if you want to keep the plan handy".
 * This is the card. Single-page A5-portrait so the user can fold it,
 * keep it in a wallet, or print on Letter without re-scaling.
 *
 * Inputs are deliberately minimal — the casual mode produces short
 * replies, so the card is short. If the user wants a full Rx, they
 * are already in the wrong mode (analyse / patient is where the
 * formal Rx lives).
 */
export interface SelfCareCardInput {
  /** What Mörbius said the situation is — e.g. "common cold". */
  condition: string;
  /** OTC medicines, free-form. Each entry one line on the card. */
  meds: string[];
  /** Lifestyle tips. */
  tips: string[];
  /** ONE sentence escalation rule — when to call a doctor. */
  whenToSeeADoctor: string;
  /** Optional patient name / nickname for the header. */
  patientName?: string;
  /** ISO date string. Defaults to today. */
  generatedAt?: string;
}

const PAGE_W = 419.5; // A5 width in points
const PAGE_H = 595.3; // A5 height in points

export async function buildSelfCareCard(input: SelfCareCardInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const ink = rgb(0.04, 0.09, 0.18);
  const muted = rgb(0.34, 0.42, 0.56);
  const accent = rgb(0.06, 0.71, 0.51); // bio-green
  const rule = rgb(0.86, 0.89, 0.94);

  let y = PAGE_H - 50;

  // Header
  page.drawText('Mörbius', { x: 32, y, size: 22, font: fontBold, color: ink });
  page.drawText('· self-care card', { x: 105, y: y + 2, size: 11, font: fontItalic, color: muted });
  y -= 26;
  page.drawLine({
    start: { x: 32, y },
    end: { x: PAGE_W - 32, y },
    thickness: 0.6,
    color: rule,
  });
  y -= 22;

  // Condition
  page.drawText('CONDITION', { x: 32, y, size: 8, font: fontBold, color: muted });
  y -= 14;
  page.drawText(input.condition, { x: 32, y, size: 16, font: fontBold, color: accent });
  y -= 28;

  // Meds
  page.drawText('OVER-THE-COUNTER MEDICINES', { x: 32, y, size: 8, font: fontBold, color: muted });
  y -= 14;
  for (const m of input.meds.slice(0, 4)) {
    page.drawText(`• ${m}`, { x: 32, y, size: 11, font: fontRegular, color: ink });
    y -= 16;
  }
  y -= 8;

  // Tips
  page.drawText('LIFESTYLE TIPS', { x: 32, y, size: 8, font: fontBold, color: muted });
  y -= 14;
  for (const t of input.tips.slice(0, 4)) {
    page.drawText(`• ${t}`, { x: 32, y, size: 11, font: fontRegular, color: ink });
    y -= 16;
  }
  y -= 12;

  // Escalation
  page.drawLine({
    start: { x: 32, y },
    end: { x: PAGE_W - 32, y },
    thickness: 0.6,
    color: rule,
  });
  y -= 18;
  page.drawText('WHEN TO SEE A DOCTOR', {
    x: 32,
    y,
    size: 8,
    font: fontBold,
    color: rgb(0.96, 0.25, 0.37),
  });
  y -= 14;
  // Wrap the escalation sentence to ~50 chars per line.
  const wrap = (s: string, max = 52): string[] => {
    const out: string[] = [];
    let line = '';
    for (const word of s.split(/\s+/)) {
      if (`${line} ${word}`.trim().length > max) {
        if (line) out.push(line);
        line = word;
      } else {
        line = (line ? `${line} ` : '') + word;
      }
    }
    if (line) out.push(line);
    return out;
  };
  for (const ln of wrap(input.whenToSeeADoctor)) {
    page.drawText(ln, { x: 32, y, size: 11, font: fontRegular, color: ink });
    y -= 14;
  }

  // Footer
  const date = input.generatedAt ?? new Date().toISOString().slice(0, 10);
  const footer = input.patientName
    ? `For ${input.patientName} · ${date}`
    : `Generated ${date} · Mörbius v0.5`;
  page.drawText(footer, {
    x: 32,
    y: 36,
    size: 9,
    font: fontItalic,
    color: muted,
  });
  page.drawText('Not a substitute for clinician advice if symptoms worsen.', {
    x: 32,
    y: 22,
    size: 8,
    font: fontItalic,
    color: muted,
  });

  return pdf.save();
}

/**
 * Heuristically extract the casual-mode card fields from a Mörbius
 * reply. The casual prompt asks for a specific shape — condition,
 * 1-2 meds, 2-3 tips, ONE escalation rule — so the parser pattern-
 * matches that. Returns null when the reply doesn't look like a
 * casual-mode answer (so the UI doesn't surface the download button).
 */
export function extractCasualCardFields(reply: string): SelfCareCardInput | null {
  const lower = reply.toLowerCase();
  // Heuristic: casual replies almost always contain "this sounds
  // like" or "no immediate worry" or end with the escalation phrase.
  const hasCasualShape =
    lower.includes('sounds like') ||
    lower.includes('no immediate') ||
    lower.includes('save this card') ||
    lower.includes('common cold') ||
    lower.includes('rest and');
  if (!hasCasualShape) return null;

  // Pull the condition — the noun-phrase after "sounds like" / "this
  // is most likely". Fallback: first sentence.
  const condMatch =
    reply.match(/(?:sounds like|most likely|appears to be|looks like)\s+([^.,;!?]+)/i)?.[1] ??
    reply.split(/[.!?]/)[0]?.trim() ??
    'Self-care plan';

  // Bullet-ish lines starting with -, •, *, 1., etc.
  const lineExtract = (haystack: string): string[] =>
    haystack
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*[-•*]\s+|^\s*\d+\.\s+/, '').trim())
      .filter((l) => l.length > 4 && l.length < 140);

  const allLines = lineExtract(reply);
  // Meds typically mention mg / dose / tablet; tips don't.
  const medsHints =
    /(\bmg\b|\bml\b|\bdose\b|tablet|capsule|paracetamol|acetaminophen|ibuprofen|naproxen|aspirin|cetirizine|loratadine|saline|dextromethorphan|guaifenesin)/i;
  const meds = allLines.filter((l) => medsHints.test(l)).slice(0, 4);
  const tips = allLines.filter((l) => !medsHints.test(l)).slice(0, 4);

  const escMatch =
    reply.match(/see a doctor[^.!?]*[.!?]/i)?.[0] ??
    reply.match(/call (?:911|112|emergency)[^.!?]*[.!?]/i)?.[0] ??
    'See a doctor if symptoms worsen, persist beyond 48 h, or you develop high fever, breathing trouble, severe pain, or blood.';

  return {
    condition: condMatch.replace(/^[-—]\s*/, '').slice(0, 80),
    meds: meds.length ? meds : ['Acetaminophen 500 mg every 6 h as needed (max 3 g/day)'],
    tips: tips.length ? tips : ['Rest', 'Hydrate', 'Warm fluids'],
    whenToSeeADoctor: escMatch.trim(),
  };
}
