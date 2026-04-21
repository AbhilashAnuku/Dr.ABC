export { TriageAgent } from './triage.ts';
export { ValidatorAgent } from './validator.ts';
export { MorbiusChatAgent, timeOfDay } from './chat.ts';
export type { ChatInput, ChatOutput } from './chat.ts';
// drug-safety.ts holds an additional curated mini-DB (40+ severity-
// ranked interaction rules with citations) the chat agent can use as
// a second-pass check alongside the bigger DRUG_*_TABLE knowledge
// already exported below. Renamed locally to avoid collision with the
// canonical `checkDrugSafety` from packages/agents/src/knowledge/.
export {
  checkDrugSafety as checkDrugSafetyCurated,
  DRUG_SAFETY_RULE_COUNT,
} from './drug-safety.ts';
export type {
  DrugWarning,
  PatientProfile as CuratedPatientProfile,
} from './drug-safety.ts';
export {
  DEFAULT_BACKEND_PRIORITY,
  DiagnosticAgent,
  pickDiagnosticBackend,
  resolveBackendPriority,
  SingleClaudeEnsemble,
  tryCreateDiagnosticAgent,
  type DiagnosticBackendKind,
  type DiagnosticEnsemble,
} from './diagnostic.ts';
export { HuggingFaceEnsemble } from './ensembles/hf.ts';
export { NvidiaEnsemble } from './ensembles/nvidia.ts';
export { OllamaEnsemble } from './ensembles/ollama.ts';
export {
  Bm25Retriever,
  createSeedLibraryAgent,
  LibraryAgent,
  SEED_CORPUS,
  type Citation,
  type LibraryDocument,
  type LibraryInput,
  type LibraryOutput,
  type RetrievalResult,
  type Retriever,
} from './library.ts';
export {
  embedQuery,
  PgVectorRetriever,
  tryCreatePgVectorRetriever,
  type PgVectorRetrieverOptions,
} from './library-pgvector.ts';
export {
  createDemoProfileAgent,
  DEMO_BUNDLE,
  DEMO_PATIENT_HASH,
  InMemoryProfileStore,
  ProfileAgent,
  type PatientBundle,
  type ProfileAction,
  type ProfileInput,
  type ProfileOutput,
  type ProfileStore,
} from './profile.ts';
export {
  ClaudeVisionBackend,
  ImagingAgent,
  pickImagingBackend,
  PySvcVisionBackend,
  tryCreateImagingAgent,
  type ImagingBackendKind,
  type ImagingFactoryEnv,
  type VisionBackend,
  type VisionBackendResult,
} from './imaging.ts';
export {
  demoFitnessSnapshot,
  fitnessSnapshotFromEnv,
  GoogleFitClient,
  type FitnessProvider,
  type FitnessSnapshot,
  type GoogleFitClientOptions,
  type HrSample,
  type SleepSession,
  type StepBucket,
  type WorkoutSession,
} from './fitness/index.ts';
export {
  dedupe,
  rank,
  ResearchAgent,
  searchClinicalTrials,
  searchPubmed,
  searchWho,
} from './research/index.ts';
export { FACT_SHEETS } from './research/who.ts';
export {
  checkCitedClaims,
  citedEvidence,
  EvidenceSynthAgent,
  isClinicalClaim,
  parseCitations,
  trySynthBackend,
  type CitedClaimsCheck,
  type SynthBackend,
} from './synth/index.ts';
export {
  buildAllSpecialists,
  CardiologyAgent,
  DermatologyAgent,
  EndocrinologyAgent,
  NeurologyAgent,
  OncologyAgent,
  PulmonologyAgent,
  routeToSpecialist,
  SPECIALTY_PROMPTS,
  SpecialistAgent,
  type SpecialtyId,
} from './specialists/index.ts';
export {
  deterministicRefine,
  isValidProposal,
  MAX_PROPOSED_PREFIX_CHARS,
  pickWorstExemplars,
  proposeNewPrefix,
  renderMetaPrompt,
  type ProposeOpts,
  type TuneProposal,
  type TunerExemplar,
} from './tuner.ts';
export {
  classifyAndPrefix,
  classifyTone,
  HOUSE_TONE_PREFIX,
  tonePrefix,
  type Tone,
  type ToneVerdict,
} from './tone.ts';
export {
  ALLERGY_TABLE_SIZE,
  canonicaliseDrug,
  checkDrugSafety,
  CONDITION_TABLE_SIZE,
  DRUG_ALLERGY_ALERTS,
  DRUG_CONDITION_ALERTS,
  DRUG_DRUG_INTERACTIONS,
  DRUG_SYNONYMS,
  findSocByCondition,
  ICD10_TABLE,
  ICD10_TABLE_SIZE,
  INTERACTION_TABLE_SIZE,
  isKnownIcd10,
  KNOWLEDGE_MANIFEST,
  lookupIcd10,
  lookupSoc,
  RED_FLAG_RULE_COUNT,
  RED_FLAG_RULES,
  scanRedFlags,
  searchIcd10,
  severityRank,
  SOC_TEMPLATE_COUNT,
  SOC_TEMPLATES,
  specialtyForCondition,
  topEscalation,
  type DrugAllergyAlert,
  type DrugConditionAlert,
  type DrugInteraction,
  type EsiTier,
  type Icd10Entry,
  type Icd10Specialty,
  type MatchedAlert,
  type RedFlagHit,
  type RedFlagRule,
  type Severity,
  type SocRxItem,
  type StandardOfCareTemplate,
} from './knowledge/index.ts';
export {
  calibrateStage,
  DEFAULT_THRESHOLDS,
  runCalibrationCycle,
  statsFromActivity,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  THRESHOLD_STEP,
  type CalibrationCycleInput,
  type CalibrationCycleOutput,
  type GauntletStage,
  type GauntletThresholds,
  type StageStats,
} from './calibrator.ts';
// Multimodal fusion — voice + lab PDF + skin photo into one consult turn.
export {
  buildMultimodalContext,
  type MultimodalInput,
  type MultimodalSummary,
  type MultimodalSourceTag,
} from './multimodal/index.ts';

// Sequential error correction — gradient-boosting-style residuals
// applied to differential vectors. Mörbius's "no kill, no sorry"
// self-correction loop. Records gauntlet failures + architect overrides
// + follow-up retractions and applies bounded probability shifts on
// the next inference for similar feature signatures.
export {
  applyBoost,
  featureSignature,
  recordError,
  summariseBoostingJournal,
  type BoostedDifferential,
  type BoostingStats,
  type CorrectionDirection,
  type Differential as BoostingDifferential,
  type ErrorEvent,
  type RecordErrorInput,
} from './boosting/index.ts';

// Knowledge graph — graphify-style continuous-learning module.
// `loadGraph` + `saveGraph` are intentionally NOT re-exported here:
// they're node-only (read/write JSON via `node:fs/promises`) and live
// at `@dr-abc/agents/knowledge-graph/io`. Keeping them off this barrel
// prevents Vite from bundling `node:fs/promises` into the web app.
export {
  analyzeGraph,
  boostDifferentials,
  buildGraph,
  clusterGraph,
  edgeWeight,
  extractEntityMentions,
  extractFromAbstract,
  extractFromConsult,
  mergeGraph,
  relevantContext,
  relu,
  renderReport,
  sigmoid,
  softmax,
  spreadingActivation,
  type ActivationResult,
  type ConfidenceTag,
  type Extraction,
  type GraphAnalysis,
  type GraphEdge,
  type GraphNode,
  type MedicalGraph,
  type RelevantContextBlock,
  type RerankInput,
  type RerankOutput,
} from './knowledge-graph/index.ts';
