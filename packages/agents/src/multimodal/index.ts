/**
 * @dr-abc/agents · multimodal
 *
 * Mörbius's multimodal consult input layer. Design brief: voice + lab
 * PDF + skin photo all flow into one consult turn, and the evidence
 * array tracks which input informed each line.
 *
 * What this module does:
 *   - Accepts heterogeneous inputs (audio blob · PDF text · image)
 *   - Routes each to its specialist extractor (Whisper-style transcribe ·
 *     PDF-text parse · py-svc dermatology pipeline)
 *   - Fuses the extracted summaries into one combined patient context
 *     string the diagnostic agent can ingest
 *   - Tags every line of the combined context with its provenance
 *     (`voice` / `pdf:filename.pdf` / `image:lesion.png`) so downstream
 *     evidence arrays can cite the source.
 *
 * Real implementations live in py-svc (whisper.cpp / pdf parser /
 * MONAI dermatology). This module is the TS-side fusion layer that
 * orchestrates them.
 */

export {
  buildMultimodalContext,
  type MultimodalInput,
  type MultimodalSummary,
  type MultimodalSourceTag,
} from './fuse.ts';
