/**
 * Stage 8 specialist agents — six independent classes that wrap the
 * shared DiagnosticEnsemble with a specialty-tuned system prompt.
 *
 * Triage detects the specialty from the chief complaint via
 * `routeToSpecialist()`; the orchestrator dispatches to the matching
 * SpecialistAgent OR falls back to the generalist DiagnosticAgent
 * when nothing matches.
 *
 * Adding a seventh specialty is three steps:
 *   1. Add the entry to AgentKind in `packages/types/src/index.ts`.
 *   2. Add the system prompt + an entry in `routeToSpecialist()`.
 *   3. Drop a new `<specialty>.ts` file alongside the others.
 */

export { SpecialistAgent } from './base.ts';
export { CardiologyAgent } from './cardiology.ts';
export { NeurologyAgent } from './neurology.ts';
export { OncologyAgent } from './oncology.ts';
export { PulmonologyAgent } from './pulmonology.ts';
export { EndocrinologyAgent } from './endocrinology.ts';
export { DermatologyAgent } from './dermatology.ts';
export { SPECIALTY_PROMPTS, type SpecialtyId, routeToSpecialist } from './prompts.ts';

import type { DiagnosticEnsemble } from '../diagnostic.ts';
import type { SpecialistAgent } from './base.ts';
import { CardiologyAgent } from './cardiology.ts';
import { DermatologyAgent } from './dermatology.ts';
import { EndocrinologyAgent } from './endocrinology.ts';
import { NeurologyAgent } from './neurology.ts';
import { OncologyAgent } from './oncology.ts';
import type { SpecialtyId } from './prompts.ts';
import { PulmonologyAgent } from './pulmonology.ts';

/**
 * Build all six specialists from a single shared ensemble. Returns a
 * map keyed by SpecialtyId so callers can fetch the right one once a
 * specialty is detected.
 */
export function buildAllSpecialists(
  ensemble: DiagnosticEnsemble,
): Record<SpecialtyId, SpecialistAgent> {
  return {
    cardiology: new CardiologyAgent(ensemble),
    neurology: new NeurologyAgent(ensemble),
    oncology: new OncologyAgent(ensemble),
    pulmonology: new PulmonologyAgent(ensemble),
    endocrinology: new EndocrinologyAgent(ensemble),
    dermatology: new DermatologyAgent(ensemble),
  };
}
