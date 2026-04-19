/**
 * @dr-abc/db — Drizzle ORM schema + migrations for Postgres + pgvector.
 *
 * Tables shipped in Phase B:
 *   - patient                 (FHIR R4 Patient)
 *   - coverage                (FHIR R4 Coverage)
 *   - allergy_intolerance     (FHIR R4 AllergyIntolerance)
 *   - condition               (FHIR R4 Condition)
 *
 * Wired into the runtime in Phase 4 (Compliance + audit-grade
 * persistence). Phase B uses an InMemoryProfileStore in
 * `packages/agents/src/profile.ts` that mirrors these row shapes.
 */
export * from './schema.ts';
