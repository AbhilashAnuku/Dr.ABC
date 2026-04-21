import { describe, expect, test } from 'bun:test';
import { buildMultimodalContext } from './fuse.ts';

describe('multimodal · buildMultimodalContext', () => {
  test('empty input yields empty context', () => {
    const r = buildMultimodalContext({});
    expect(r.combinedContext).toBe('');
    expect(r.stats.charCount).toBe(0);
    expect(r.stats.voice).toBe(false);
    expect(r.stats.pdfCount).toBe(0);
    expect(r.stats.imageCount).toBe(0);
  });

  test('voice-only fuses with provenance tags', () => {
    const r = buildMultimodalContext({
      voiceTranscript: 'I have crushing chest pain radiating to my left arm.',
    });
    expect(r.combinedContext).toMatch(/VOICE TRANSCRIPT/);
    expect(r.combinedContext).toMatch(/crushing chest pain/);
    expect(r.provenance.every((p) => p.source === 'voice')).toBe(true);
    expect(r.stats.voice).toBe(true);
  });

  test('lab PDF + skin image fuse with per-line refs', () => {
    const r = buildMultimodalContext({
      labPdfs: [{ filename: 'cbc.pdf', text: 'WBC: 12.5\nHGB: 13.2\n\nNeutrophils: 78%' }],
      skinImages: [
        {
          filename: 'lesion.png',
          finding: {
            asymmetry: 0.32,
            borderIrregularity: 0.45,
            colorVariegation: 0.71,
            diameterMm: 7,
            evolution: 'changing',
            malignancyConfidence: 0.62,
            notes: 'Asymmetric pigmented lesion · refer dermatology.',
          },
        },
      ],
    });
    expect(r.combinedContext).toMatch(/LAB PDF · cbc.pdf/);
    expect(r.combinedContext).toMatch(/SKIN LESION · lesion.png/);
    expect(r.combinedContext).toMatch(/malignancy confidence 62%/);
    expect(r.stats.pdfCount).toBe(1);
    expect(r.stats.imageCount).toBe(1);
    const pdfLines = r.provenance.filter((p) => p.source === 'pdf');
    expect(pdfLines.length).toBeGreaterThan(0);
    expect(pdfLines.every((p) => p.ref === 'cbc.pdf')).toBe(true);
  });

  test('truncates long PDFs at 2 k chars', () => {
    const longText = 'word '.repeat(1000); // ~5 k chars
    const r = buildMultimodalContext({ labPdfs: [{ filename: 'long.pdf', text: longText }] });
    expect(r.combinedContext.length).toBeLessThan(longText.length + 200);
    expect(r.combinedContext).toMatch(/…/);
  });
});
