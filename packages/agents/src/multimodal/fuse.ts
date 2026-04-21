/**
 * Multimodal fusion — turn voice + lab PDF + skin photo into one
 * patient-context string the diagnostic agent can prepend to its
 * prompt. Each line is tagged with its source so evidence arrays
 * downstream can trace findings back to the input that produced them.
 */

export type MultimodalSourceTag = 'voice' | 'pdf' | 'image';

/** Input bundle for a single consult turn. */
export interface MultimodalInput {
  /** Voice memo transcribed via Whisper (or browser SpeechRecognition). */
  voiceTranscript?: string;
  /** Lab PDF parsed text (py-svc /pdf/extract or pdf-lib in browser). */
  labPdfs?: Array<{ filename: string; text: string }>;
  /** Skin lesion photos with optional MONAI dermatology output. */
  skinImages?: Array<{
    filename: string;
    /** ABCDE rule heatmap finding from py-svc dermatology pipeline. */
    finding?: {
      asymmetry: number; // 0..1
      borderIrregularity: number;
      colorVariegation: number;
      diameterMm: number;
      evolution: 'stable' | 'changing' | 'unknown';
      malignancyConfidence: number; // 0..1
      notes: string;
    };
  }>;
}

export interface MultimodalSummary {
  /** Combined patient-context string ready for the diagnostic agent. */
  combinedContext: string;
  /** Per-line provenance — `[lineIndex] → tag`. */
  provenance: Array<{ line: string; source: MultimodalSourceTag; ref: string }>;
  /** Quick stats for the dev-console. */
  stats: { voice: boolean; pdfCount: number; imageCount: number; charCount: number };
}

/**
 * Fuse the multimodal bundle into one patient-context string.
 *
 * Output shape:
 *   ╭ MULTIMODAL CONTEXT
 *   │ Voice transcript:
 *   │   <voice text>
 *   │ Lab PDF · cbc-2026-05-03.pdf:
 *   │   <pdf text, truncated to 2k chars>
 *   │ Skin lesion · lesion.png:
 *   │   ABCDE — A:0.3 B:0.4 C:0.7 D:7mm E:changing · malignancy 0.62
 *   │   <notes>
 *   ╰
 *
 * Empty sections are omitted. The diagnostic agent prompts work the
 * same whether 1 or 3 modalities are present.
 */
export function buildMultimodalContext(input: MultimodalInput): MultimodalSummary {
  const lines: Array<{ line: string; source: MultimodalSourceTag; ref: string }> = [];

  if (input.voiceTranscript?.trim()) {
    lines.push({ line: 'VOICE TRANSCRIPT:', source: 'voice', ref: 'voice' });
    lines.push({ line: input.voiceTranscript.trim(), source: 'voice', ref: 'voice' });
  }

  for (const pdf of input.labPdfs ?? []) {
    if (!pdf.text.trim()) continue;
    lines.push({ line: `LAB PDF · ${pdf.filename}:`, source: 'pdf', ref: pdf.filename });
    // Cap each PDF at 2 k chars — the diagnostic agent's window is
    // shared across all modalities + the chief complaint + history.
    const text = pdf.text.length > 2000 ? `${pdf.text.slice(0, 2000)}…` : pdf.text;
    for (const para of text.split(/\n\n+/).filter((p) => p.trim().length > 0)) {
      lines.push({ line: para.trim(), source: 'pdf', ref: pdf.filename });
    }
  }

  for (const img of input.skinImages ?? []) {
    lines.push({ line: `SKIN LESION · ${img.filename}:`, source: 'image', ref: img.filename });
    if (img.finding) {
      const f = img.finding;
      lines.push({
        line:
          `ABCDE — A:${f.asymmetry.toFixed(2)} B:${f.borderIrregularity.toFixed(2)} ` +
          `C:${f.colorVariegation.toFixed(2)} D:${f.diameterMm}mm E:${f.evolution} · ` +
          `malignancy confidence ${(f.malignancyConfidence * 100).toFixed(0)}%`,
        source: 'image',
        ref: img.filename,
      });
      if (f.notes.trim()) {
        lines.push({ line: f.notes.trim(), source: 'image', ref: img.filename });
      }
    } else {
      lines.push({
        line: '(image attached · py-svc dermatology pipeline returned no finding)',
        source: 'image',
        ref: img.filename,
      });
    }
  }

  const combinedContext =
    lines.length > 0
      ? `╭ MULTIMODAL CONTEXT\n${lines.map((l) => `│ ${l.line}`).join('\n')}\n╰`
      : '';

  return {
    combinedContext,
    provenance: lines,
    stats: {
      voice: !!input.voiceTranscript?.trim(),
      pdfCount: (input.labPdfs ?? []).filter((p) => p.text.trim()).length,
      imageCount: (input.skinImages ?? []).length,
      charCount: combinedContext.length,
    },
  };
}
