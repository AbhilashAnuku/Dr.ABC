/**
 * @dr-abc/types — shared type contracts across the entire Mörbius platform.
 * Every agent input/output, every API boundary, every wire format lives here.
 */

// ============================================================
//  AGENT IDENTITY
// ============================================================
export const AgentKind = {
  Orchestrator: 'orchestrator',
  Triage: 'triage',
  Diagnostic: 'diagnostic',
  Imaging: 'imaging',
  AnatomySim: 'anatomy-sim',
  Quantum: 'quantum',
  Prescription: 'prescription',
  Pharma: 'pharma',
  Library: 'library',
  Profile: 'profile',
  Research: 'research',
  Gesture: 'gesture',
  Voice: 'voice',
  UIUX: 'ui-ux',
  Validator: 'validator',
  Safety: 'safety',
  Privacy: 'privacy',
  // Conversational replies generated via the cascade (NVIDIA NIM →
  // HuggingFace → fallback) for greetings, small-talk, and vague
  // exploratory turns. Stops the surface feeling like a JSON robot.
  Chat: 'chat',
  // Stage 8 specialist agents — each runs the same diagnostic ensemble
  // with a specialty-tuned system prompt + curated reference set.
  // Triage routes to the matching specialist; DiagnosticAgent stays the
  // generalist fallback when nothing matches.
  Cardiology: 'cardiology',
  Neurology: 'neurology',
  Oncology: 'oncology',
  Pulmonology: 'pulmonology',
  Endocrinology: 'endocrinology',
  Dermatology: 'dermatology',
} as const;

export type AgentKind = (typeof AgentKind)[keyof typeof AgentKind];

// ============================================================
//  INTENT TAXONOMY
// ============================================================
export const Intent = {
  Symptom: 'symptom',
  ImageAnalysis: 'image-analysis',
  AnatomyShow: 'anatomy-show',
  DrugQuery: 'drug-query',
  ReadAbout: 'read-about',
  ProfileOp: 'profile-op',
  Prescription: 'prescription',
  Research: 'research',
  GeneralChat: 'general-chat',
  Ambiguous: 'ambiguous',
  Emergency: 'emergency',
} as const;

export type Intent = (typeof Intent)[keyof typeof Intent];

// ============================================================
//  TASK ENVELOPE — flows between every agent
// ============================================================
export type PurposeOfUse = 'TREATMENT' | 'RESEARCH' | 'EMERGENCY' | 'EDUCATION';

export interface TaskContext {
  sessionId: string;
  patientIdHash: string | null;
  purposeOfUse: PurposeOfUse;
  consentToken: string | null;
  locale: string;
  deviceClass: 'web' | 'desktop' | 'mobile' | 'headset' | 'kiosk';
}

export interface TraceEntry {
  agent: AgentKind;
  ts: number;
  durationMs: number;
  confidence: number;
  notes?: string;
}

export interface Task<TPayload = unknown> {
  taskId: string;
  parentTaskId: string | null;
  intent: Intent;
  priority: 1 | 2 | 3 | 4 | 5;
  deadlineMs: number;
  payload: TPayload;
  context: TaskContext;
  trace: TraceEntry[];
  createdAt: number;
}

// ============================================================
//  AGENT RESULT — what every agent returns
// ============================================================
export type Verdict = 'pass' | 'fail' | 'defer-to-human';

export interface AgentResult<TData = unknown> {
  agent: AgentKind;
  taskId: string;
  verdict: Verdict;
  confidence: number;
  data: TData;
  evidence: string[];
  warnings: string[];
  followUps: Intent[];
  cost: { tokens: number; ms: number; usd: number };
}

// ============================================================
//  CLINICAL DOMAIN OBJECTS
// ============================================================
export interface Symptom {
  text: string;
  durationDays?: number;
  severity?: 1 | 2 | 3 | 4 | 5;
  bodyRegion?: string;
}

export interface Vitals {
  hrBpm?: number;
  systolic?: number;
  diastolic?: number;
  spo2Pct?: number;
  tempC?: number;
  rrPerMin?: number;
}

/** Emergency Severity Index — 1 (resuscitate) to 5 (non-urgent) */
export type ESILevel = 1 | 2 | 3 | 4 | 5;

export interface TriageInput {
  symptoms: Symptom[];
  vitals?: Vitals;
  ageYears?: number;
  sex?: 'M' | 'F' | 'X';
}

export interface TriageOutput {
  esi: ESILevel;
  redFlags: string[];
  suggestedNextAgent: AgentKind;
  rationale: string;
  /**
   * True when the patient's input is too vague for a differential AND
   * no red flags fired. The orchestrator skips the diagnostic agent
   * and the synth layer renders clarifyingQuestions instead — like a
   * real doctor opening a consult with "tell me more".
   */
  needsClarification?: boolean;
  /**
   * 3-6 SOAP-style follow-up questions in warm-doctor voice, rendered
   * verbatim by the chat surface when needsClarification is true.
   */
  clarifyingQuestions?: string[];
  /**
   * Short one-line acknowledgement painted above the questions so the
   * patient sees that the system heard them first.
   */
  acknowledgement?: string;
}

export interface Differential {
  condition: string;
  icd10?: string;
  probability: number;
  supportingEvidence: string[];
  counterEvidence: string[];
}

export interface DiagnosticInput {
  text: string;
  triage?: TriageOutput;
  vitals?: Vitals;
  ageYears?: number;
  sex?: 'M' | 'F' | 'X';
}

export interface DiagnosticOutput {
  differentials: Differential[];
  recommendedTests: string[];
  recommendedSpecialty: string;
  modelUsed: string;
}

// ============================================================
//  IMAGING DOMAIN
// ============================================================
export type ImagingModality =
  | 'xray-chest'
  | 'xray-other'
  | 'ct'
  | 'mri'
  | 'ultrasound'
  | 'dermatology-photo'
  | 'retinal'
  | 'histopathology';

export interface ImagingFinding {
  /** Plain-language description of the abnormality. */
  description: string;
  /** Region of interest (e.g. "right lower lobe", "L4-L5 disc"). */
  location?: string;
  /** Confidence the finding is real (separate from differential probability). */
  confidence: number;
  /** mild | moderate | severe | critical — for triage prioritization. */
  severity?: 'mild' | 'moderate' | 'severe' | 'critical';
  /** Modality-specific scoring if applicable (BI-RADS, Lung-RADS, etc.). */
  standardizedScore?: { system: string; value: string };
}

export interface ImagingInput {
  /** Base64-encoded image bytes (no data URL prefix). */
  imageBase64: string;
  /** MIME type — image/jpeg, image/png. */
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  modality: ImagingModality;
  /** Optional anatomical region hint (e.g. "left knee", "abdomen"). */
  bodyRegion?: string;
  /** Optional clinical context the radiologist would normally have. */
  clinicalContext?: string;
}

export interface ImagingOutput {
  modality: ImagingModality;
  findings: ImagingFinding[];
  /** Top-line impression — one sentence the clinician sees first. */
  impression: string;
  /** Suggested next investigations / consults. */
  recommendedFollowup: string[];
  /** Backend used to produce this report — model name or sidecar id. */
  backendUsed: string;
  /**
   * Optional segmentation/heatmap overlay from a sidecar backend.
   * PNG bytes, base64-encoded, same dimensions as the input image.
   * Renderable by the UI on top of the original frame.
   */
  overlayPngBase64?: string;
  /** Fraction of pixels lit by the overlay mask, 0..1. */
  overlayCoverage?: number;
}

// ============================================================
//  RESEARCH AGENT — live evidence retrieval
// ============================================================
export type EvidenceSource = 'pubmed' | 'clinicaltrials' | 'who';

export interface Evidence {
  /** Stable identifier across re-runs — used for dedup + footnote keys. */
  id: string;
  source: EvidenceSource;
  title: string;
  summary: string;
  /** Authoritative URL for the original record. Always present. */
  url: string;
  /** Publication or last-update year, when known. */
  year?: number;
  /** Per-source extras (PMID, NCT-id, fact-sheet section). */
  meta?: Record<string, string | number | boolean>;
  /** Relevance to the question, 0..1, set by the ResearchAgent's ranker. */
  relevance?: number;
}

export interface ResearchInput {
  /** The question or condition the agent is researching. */
  query: string;
  /** Cap per source — most callers want 5–10. */
  perSourceLimit?: number;
  /** Optional restriction; default is all three sources fanned out in parallel. */
  sources?: EvidenceSource[];
}

export interface ResearchOutput {
  query: string;
  evidence: Evidence[];
  /** Sources that errored (so the UI can show "WHO unavailable" etc.). */
  failedSources: { source: EvidenceSource; error: string }[];
  /** Total wall-clock to fan-out + dedupe, for the perf trace. */
  elapsedMs: number;
}

// ============================================================
//  EVIDENCE-SYNTH AGENT — turns evidence into a footnoted answer
// ============================================================
export interface ClaimWithCitations {
  /** A single clinical sentence from the synthesised answer. */
  text: string;
  /** 1-based indices into the evidence array (matches the [n] markers). */
  citations: number[];
}

export interface SynthInput {
  /** The original question Mörbius is answering. */
  query: string;
  /** Evidence list to weave footnotes from — usually ResearchOutput.evidence. */
  evidence: Evidence[];
  /** Hard cap on answer length in tokens. Default 512. */
  maxTokens?: number;
}

export type SynthConfidence = 'high' | 'medium' | 'low';

export interface SynthOutput {
  query: string;
  /** The full answer text with [n] footnote markers preserved. */
  answer: string;
  /** Sentence-level claim breakdown for the cited-claims gate. */
  claims: ClaimWithCitations[];
  /** Subset of evidence that was actually referenced ≥1× in the answer. */
  citedEvidence: Evidence[];
  /** Confidence rating: high (≥3 sources concur), medium, low. */
  confidence: SynthConfidence;
  /** Backend model used (e.g. "nvidia:meta/llama-3.3-70b-instruct"). */
  modelUsed: string;
  /** Wall-clock cost for the perf trace. */
  elapsedMs: number;
}

// ============================================================
//  ORCHESTRATOR EVENTS — streamed to the UI
// ============================================================
export type OrchestratorEvent =
  | { type: 'task.created'; task: Task }
  | { type: 'agent.started'; agent: AgentKind; taskId: string }
  | { type: 'agent.token'; agent: AgentKind; token: string }
  | { type: 'agent.completed'; result: AgentResult }
  | { type: 'agent.failed'; agent: AgentKind; error: string }
  | { type: 'validation.passed'; taskId: string }
  | { type: 'validation.failed'; taskId: string; reason: string }
  | { type: 'evidence.found'; agent: AgentKind; evidence: Evidence[] }
  | { type: 'pipeline.completed'; finalResult: AgentResult }
  | { type: 'pipeline.aborted'; reason: string };
