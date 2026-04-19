/**
 * Drizzle schema — FHIR R4 minimal bundle for the Profile Agent.
 *
 * Scope (Phase B): Patient + Coverage + AllergyIntolerance + Condition.
 * The schema is canonical and runtime-ready, but the Phase B Profile
 * Agent ships against an InMemoryProfileStore that mirrors the same
 * shape; the Postgres backend lands when DATABASE_URL is wired in
 * Phase 4 (Compliance + audit-grade persistence).
 *
 * Field naming follows FHIR R4 verbatim (e.g. `birthDate`, `gender`)
 * so JSON round-trips match the FHIR REST specification with no
 * adapter layer.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------
//  FHIR Patient
//  https://hl7.org/fhir/R4/patient.html
// ---------------------------------------------------------------
export const patient = pgTable('patient', {
  /** Server-assigned UUID. FHIR `Patient.id`. */
  id: varchar('id', { length: 64 }).primaryKey(),
  /**
   * Hashed external identifier — never the raw national-id / SSN.
   * Source-of-truth maps live encrypted off-database in the audit vault.
   */
  patientIdHash: varchar('patient_id_hash', { length: 128 }).notNull().unique(),
  /** FHIR `Patient.name[0].given` + `family`, joined for display. */
  displayName: text('display_name').notNull(),
  /** FHIR `Patient.gender` — administrative gender, NOT clinical sex. */
  gender: varchar('gender', { length: 16 }),
  /** FHIR `Patient.birthDate` — ISO date string. Stored as date-tagged JSON for FHIR fidelity. */
  birthDate: varchar('birth_date', { length: 10 }),
  /** FHIR `Patient.active`. */
  active: boolean('active').notNull().default(true),
  /** FHIR `Patient.communication[0].language.coding[0].code`. */
  preferredLanguage: varchar('preferred_language', { length: 16 }).default('en-US'),
  /** Free-form FHIR extension bag — telecom, address, identifier list, etc. */
  fhirExtra: jsonb('fhir_extra').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------
//  FHIR Coverage — insurance / payer
//  https://hl7.org/fhir/R4/coverage.html
// ---------------------------------------------------------------
export const coverage = pgTable('coverage', {
  id: varchar('id', { length: 64 }).primaryKey(),
  patientId: varchar('patient_id', { length: 64 })
    .notNull()
    .references(() => patient.id, { onDelete: 'cascade' }),
  /** FHIR `Coverage.status` — active | cancelled | draft | entered-in-error. */
  status: varchar('status', { length: 24 }).notNull().default('active'),
  /** FHIR `Coverage.payor[0].display` — insurer name. */
  payor: text('payor').notNull(),
  /** FHIR `Coverage.subscriberId` — member id on the card. */
  subscriberId: varchar('subscriber_id', { length: 64 }),
  /** FHIR `Coverage.policyHolder` reference, group, plan, period.* — JSON bag. */
  fhirExtra: jsonb('fhir_extra').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------
//  FHIR AllergyIntolerance
//  https://hl7.org/fhir/R4/allergyintolerance.html
// ---------------------------------------------------------------
export const allergyIntolerance = pgTable('allergy_intolerance', {
  id: varchar('id', { length: 64 }).primaryKey(),
  patientId: varchar('patient_id', { length: 64 })
    .notNull()
    .references(() => patient.id, { onDelete: 'cascade' }),
  /** FHIR `AllergyIntolerance.clinicalStatus.coding[0].code` — active | resolved | inactive. */
  clinicalStatus: varchar('clinical_status', { length: 24 }).notNull().default('active'),
  /** FHIR `AllergyIntolerance.verificationStatus` — confirmed | unconfirmed | refuted | entered-in-error. */
  verificationStatus: varchar('verification_status', { length: 24 }).notNull().default('confirmed'),
  /** FHIR `AllergyIntolerance.category` — food | medication | environment | biologic. */
  category: varchar('category', { length: 24 }).notNull(),
  /** FHIR `AllergyIntolerance.criticality` — low | high | unable-to-assess. */
  criticality: varchar('criticality', { length: 24 }).notNull().default('low'),
  /** FHIR `AllergyIntolerance.code.coding[0].display` — substance display name. */
  substance: text('substance').notNull(),
  /** FHIR `AllergyIntolerance.reaction[].manifestation` — JSON array of reactions. */
  reactions: jsonb('reactions')
    .$type<Array<{ manifestation: string; severity?: 'mild' | 'moderate' | 'severe' }>>()
    .default(sql`'[]'::jsonb`),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------
//  FHIR Condition
//  https://hl7.org/fhir/R4/condition.html
// ---------------------------------------------------------------
export const condition = pgTable('condition', {
  id: varchar('id', { length: 64 }).primaryKey(),
  patientId: varchar('patient_id', { length: 64 })
    .notNull()
    .references(() => patient.id, { onDelete: 'cascade' }),
  /** FHIR `Condition.clinicalStatus.coding[0].code` — active | recurrence | relapse | inactive | remission | resolved. */
  clinicalStatus: varchar('clinical_status', { length: 24 }).notNull().default('active'),
  /** FHIR `Condition.verificationStatus` — confirmed | provisional | differential | refuted. */
  verificationStatus: varchar('verification_status', { length: 24 }).notNull().default('confirmed'),
  /** FHIR `Condition.code.coding[0].code` — ICD-10 / SNOMED. */
  code: varchar('code', { length: 32 }),
  /** FHIR `Condition.code.coding[0].display` — human-readable diagnosis. */
  display: text('display').notNull(),
  /** FHIR `Condition.severity.coding[0].code` — mild | moderate | severe. */
  severity: varchar('severity', { length: 24 }),
  /** FHIR `Condition.onsetDateTime` — ISO timestamp. */
  onsetDateTime: timestamp('onset_date_time', { withTimezone: true }),
  /** FHIR `Condition.note[].text` — clinician notes. */
  notes: jsonb('notes').$type<string[]>().default(sql`'[]'::jsonb`),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------
//  Activity log — every meaningful user/agent action.
//
//  Powers the developer Training Cockpit: live cross-panel feed,
//  per-agent latency metrics, accuracy harness, eventual continuous
//  learning. Designed as an append-only journal: never mutated, only
//  inserted + queried + tailed.
//
//  Rows are ~< 4 KB each (the payload jsonb is intended for redacted
//  request/response shells, not full transcripts). Two indexes cover
//  the cockpit's two main reads — newest-first scrolling feed and
//  per-(role, route) drill-down.
// ---------------------------------------------------------------
export const activityLog = pgTable(
  'activity_log',
  {
    id: text('id').primaryKey(),
    /** Wall-clock at write time, ms since epoch. Indexed DESC for tail. */
    ts: bigint('ts', { mode: 'number' }).notNull(),
    /** Caller's role — patient | doctor | student | developer. */
    role: varchar('role', { length: 16 }).notNull(),
    /** App-facing user id (auth subject). */
    userId: varchar('user_id', { length: 64 }).notNull(),
    /** Where the action originated: '/app/clinic', '/app/lab', '/api/orchestrate', … */
    route: text('route').notNull(),
    /** What happened: 'consult.submit', 'rx.signed', 'lab.train.run', 'orchestrate.completed', … */
    action: varchar('action', { length: 64 }).notNull(),
    /** Free-form, redacted request/response context. Never PHI. */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    /** Wall-clock duration if the action wraps a timed operation. */
    latencyMs: integer('latency_ms'),
    /** ok | error — used by the cockpit to colour-code rows. */
    status: varchar('status', { length: 16 }).notNull().default('ok'),
  },
  (t) => ({
    tsIdx: index('activity_log_ts_idx').on(t.ts),
    roleRouteTsIdx: index('activity_log_role_route_idx').on(t.role, t.route, t.ts),
  }),
);

/**
 * consult_messages — durable transcript of every Mörbius ↔ patient turn.
 *
 * v0.7 promotes consult continuity from localStorage-only to the
 * database. The web client still writes locally for instant resume,
 * and POSTs each turn to /api/consults/:id/messages so the same
 * conversation is reachable from a different device or after a
 * browser-storage clear. Same per-user isolation: queries are scoped
 * by userId.
 */
export const consultMessage = pgTable(
  'consult_messages',
  {
    id: text('id').primaryKey(),
    /** The consult this turn belongs to (e.g. `cn_1730000000_abc123`). */
    consultId: varchar('consult_id', { length: 64 }).notNull(),
    /** Pseudonymous user id — same shape as activityLog.userId. */
    userId: varchar('user_id', { length: 64 }).notNull(),
    /** Wall-clock when the turn was authored. */
    ts: bigint('ts', { mode: 'number' }).notNull(),
    /** Who spoke: 'mörbius' | 'patient'. Stored as varchar to keep the
     *  schema flexible for future roles (e.g. specialist agents). */
    role: varchar('role', { length: 32 }).notNull(),
    /** The turn text. Trimmed by the orchestrator before persistence. */
    text: text('text').notNull(),
    /** Optional structured side-channel: tone classifier output, model
     *  used, evidence count, multimodal source tags, etc. */
    meta: jsonb('meta').$type<Record<string, unknown>>(),
  },
  (t) => ({
    consultIdx: index('consult_msg_consult_idx').on(t.consultId, t.ts),
    userIdx: index('consult_msg_user_idx').on(t.userId, t.ts),
  }),
);

// ---------------------------------------------------------------
//  app_user — application accounts (sign-up / sign-in).
//
//  Argon2id password hash via Bun.password.hash with OWASP-recommended
//  parameters. Email is canonicalised (trimmed + lower-cased) before
//  insert. patientIdHash links the auth identity to the FHIR Patient
//  record so a signed-in user lands on their own chart.
// ---------------------------------------------------------------
export const appUser = pgTable(
  'app_user',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    email: varchar('email', { length: 254 }).notNull().unique(),
    /** Argon2id hash · self-contained (salt + params embedded). */
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    /** UI locale preference at sign-up time. */
    locale: varchar('locale', { length: 8 }).notNull().default('en'),
    /** Link to the FHIR Patient row. Nullable so accounts can exist
     *  before a clinical record is provisioned. */
    patientIdHash: varchar('patient_id_hash', { length: 128 }),
    /** Soft-delete flag. Hard-deletes require maintainer approval. */
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
  },
  (t) => ({
    emailIdx: index('app_user_email_idx').on(t.email),
  }),
);

// ---------------------------------------------------------------
//  app_session — opaque crypto-random session tokens.
//
//  Token format: 64-char hex (32 random bytes). Stored as plain text
//  in the DB but never exposed via API — the cookie carries it back to
//  the server, and the server looks it up here. expiresAt enforces a
//  30-day sliding window; the routes refresh it on every authenticated
//  request.
// ---------------------------------------------------------------
export const appSession = pgTable(
  'app_session',
  {
    token: varchar('token', { length: 128 }).primaryKey(),
    userId: varchar('user_id', { length: 64 })
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Optional: IP / UA fingerprint for audit. Never PHI. */
    fingerprint: jsonb('fingerprint').$type<Record<string, string>>(),
  },
  (t) => ({
    userIdx: index('app_session_user_idx').on(t.userId),
    expiresIdx: index('app_session_expires_idx').on(t.expiresAt),
  }),
);

// ---------------------------------------------------------------
//  Inferred TS types — preferred over hand-rolled mirrors so the
//  store layer stays in sync with the schema.
// ---------------------------------------------------------------
export type PatientRow = typeof patient.$inferSelect;
export type PatientInsert = typeof patient.$inferInsert;
export type CoverageRow = typeof coverage.$inferSelect;
export type CoverageInsert = typeof coverage.$inferInsert;
export type AllergyIntoleranceRow = typeof allergyIntolerance.$inferSelect;
export type AllergyIntoleranceInsert = typeof allergyIntolerance.$inferInsert;
export type ConditionRow = typeof condition.$inferSelect;
export type ConditionInsert = typeof condition.$inferInsert;
export type ActivityLogRow = typeof activityLog.$inferSelect;
export type ActivityLogInsert = typeof activityLog.$inferInsert;
export type ConsultMessageRow = typeof consultMessage.$inferSelect;
export type ConsultMessageInsert = typeof consultMessage.$inferInsert;
export type AppUserRow = typeof appUser.$inferSelect;
export type AppUserInsert = typeof appUser.$inferInsert;
export type AppSessionRow = typeof appSession.$inferSelect;
export type AppSessionInsert = typeof appSession.$inferInsert;
