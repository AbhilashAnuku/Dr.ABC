-- Migration 0000 — initial FHIR R4 minimal bundle for the Profile Agent.
--
-- Hand-authored to match packages/db/src/schema.ts. Re-generated via
--   bun run --filter @dr-abc/db db:generate
-- once the schema diverges meaningfully from this baseline.

CREATE TABLE IF NOT EXISTS "patient" (
  "id" varchar(64) PRIMARY KEY,
  "patient_id_hash" varchar(128) NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "gender" varchar(16),
  "birth_date" varchar(10),
  "active" boolean NOT NULL DEFAULT true,
  "preferred_language" varchar(16) DEFAULT 'en-US',
  "fhir_extra" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "coverage" (
  "id" varchar(64) PRIMARY KEY,
  "patient_id" varchar(64) NOT NULL REFERENCES "patient"("id") ON DELETE CASCADE,
  "status" varchar(24) NOT NULL DEFAULT 'active',
  "payor" text NOT NULL,
  "subscriber_id" varchar(64),
  "fhir_extra" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "allergy_intolerance" (
  "id" varchar(64) PRIMARY KEY,
  "patient_id" varchar(64) NOT NULL REFERENCES "patient"("id") ON DELETE CASCADE,
  "clinical_status" varchar(24) NOT NULL DEFAULT 'active',
  "verification_status" varchar(24) NOT NULL DEFAULT 'confirmed',
  "category" varchar(24) NOT NULL,
  "criticality" varchar(24) NOT NULL DEFAULT 'low',
  "substance" text NOT NULL,
  "reactions" jsonb DEFAULT '[]'::jsonb,
  "recorded_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "condition" (
  "id" varchar(64) PRIMARY KEY,
  "patient_id" varchar(64) NOT NULL REFERENCES "patient"("id") ON DELETE CASCADE,
  "clinical_status" varchar(24) NOT NULL DEFAULT 'active',
  "verification_status" varchar(24) NOT NULL DEFAULT 'confirmed',
  "code" varchar(32),
  "display" text NOT NULL,
  "severity" varchar(24),
  "onset_date_time" timestamptz,
  "notes" jsonb DEFAULT '[]'::jsonb,
  "recorded_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "patient_id_hash_idx" ON "patient"("patient_id_hash");
CREATE INDEX IF NOT EXISTS "coverage_patient_idx" ON "coverage"("patient_id");
CREATE INDEX IF NOT EXISTS "allergy_patient_idx" ON "allergy_intolerance"("patient_id");
CREATE INDEX IF NOT EXISTS "condition_patient_idx" ON "condition"("patient_id");
