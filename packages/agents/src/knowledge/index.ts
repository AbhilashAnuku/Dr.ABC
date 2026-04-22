/**
 * @dr-abc/agents/knowledge — Mörbius's offline-safe medical knowledge
 * base.
 *
 * Four self-contained modules + a unified `KnowledgeBase` API:
 *
 *   - icd10              — ~150 curated ICD-10-CM codes for code
 *                          lookup + hallucination validation
 *   - interactions       — drug-drug + drug-allergy + drug-condition
 *                          safety checks
 *   - red-flags          — symptom-pattern → ESI escalation rules
 *   - standard-of-care   — guideline-anchored Rx + counsel templates
 *
 * Everything is pure-TS, in-process, deterministic. No network calls,
 * no LLM round-trips. Standing rule: the system feeds on medical
 * knowledge → this module is that knowledge source.
 */

export {
  ICD10_TABLE,
  ICD10_TABLE_SIZE,
  isKnownIcd10,
  lookupIcd10,
  searchIcd10,
  specialtyForCondition,
  type Icd10Entry,
  type Icd10Specialty,
} from './icd10.ts';

export {
  ALLERGY_TABLE_SIZE,
  canonicaliseDrug,
  checkDrugSafety,
  CONDITION_TABLE_SIZE,
  DRUG_ALLERGY_ALERTS,
  DRUG_CONDITION_ALERTS,
  DRUG_DRUG_INTERACTIONS,
  DRUG_SYNONYMS,
  INTERACTION_TABLE_SIZE,
  severityRank,
  type DrugAllergyAlert,
  type DrugConditionAlert,
  type DrugInteraction,
  type MatchedAlert,
  type Severity,
} from './interactions.ts';

export {
  RED_FLAG_RULE_COUNT,
  RED_FLAG_RULES,
  scanRedFlags,
  topEscalation,
  type EsiTier,
  type RedFlagHit,
  type RedFlagRule,
} from './red-flags.ts';

export {
  findSocByCondition,
  lookupSoc,
  SOC_TEMPLATE_COUNT,
  SOC_TEMPLATES,
  type SocRxItem,
  type StandardOfCareTemplate,
} from './standard-of-care.ts';

import { ICD10_TABLE_SIZE } from './icd10.ts';
import {
  ALLERGY_TABLE_SIZE,
  CONDITION_TABLE_SIZE,
  INTERACTION_TABLE_SIZE,
} from './interactions.ts';
import { RED_FLAG_RULE_COUNT } from './red-flags.ts';
import { SOC_TEMPLATE_COUNT } from './standard-of-care.ts';

/**
 * Knowledge-base manifest — surfaced via the dev console + the
 * Introspection tab so an operator can see what's actually in
 * Mörbius's knowledge base without reading the source.
 */
export const KNOWLEDGE_MANIFEST = {
  icd10Codes: ICD10_TABLE_SIZE,
  drugInteractions: INTERACTION_TABLE_SIZE,
  drugAllergyAlerts: ALLERGY_TABLE_SIZE,
  drugConditionAlerts: CONDITION_TABLE_SIZE,
  redFlagRules: RED_FLAG_RULE_COUNT,
  standardOfCareTemplates: SOC_TEMPLATE_COUNT,
} as const;
