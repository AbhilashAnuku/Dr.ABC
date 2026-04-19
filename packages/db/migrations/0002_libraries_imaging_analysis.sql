-- Migration 0002 -- case_library + imaging_analysis + consult_analysis.
--
-- Extends the schema with the three persistence surfaces the architect
-- asked for in v1.0.18:
--   case_library      -- demo + global + user-shared cases (no per-user PHI)
--   imaging_analysis  -- Roboflow/MONAI/Claude-vision results (no raw bytes)
--   consult_analysis  -- per-consult orchestrator verdict snapshot
--
-- Privacy boundary preserved:
--   * No raw images persisted -- storage_ref is null unless Phase-5
--     object-store opt-in is on.
--   * userId everywhere is the pseudonymous hash (same shape as
--     activity_log.user_id), never raw email.
--   * case_library has no user_id column -- it's a shared catalogue.

CREATE TABLE IF NOT EXISTS "case_library" (
  "id"              varchar(64) PRIMARY KEY,
  "scope"           varchar(24) NOT NULL DEFAULT 'demo',
  "source_ref"      varchar(128),
  "source_hash"     varchar(64) NOT NULL UNIQUE,
  "chief_complaint" text        NOT NULL,
  "diagnosis"       text        NOT NULL,
  "icd10"           varchar(16),
  "specialty"       varchar(64),
  "severity"        varchar(24),
  "drugs"           jsonb       DEFAULT '[]'::jsonb,
  "outcome"         text,
  "payload"         jsonb       DEFAULT '{}'::jsonb,
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "case_library_scope_idx"
  ON "case_library" ("scope", "created_at");

CREATE INDEX IF NOT EXISTS "case_library_specialty_idx"
  ON "case_library" ("specialty");


CREATE TABLE IF NOT EXISTS "imaging_analysis" (
  "id"           varchar(64) PRIMARY KEY,
  "user_id"      varchar(64) NOT NULL,
  "consult_id"   varchar(64),
  "modality"     varchar(32) NOT NULL,
  "body_region"  varchar(64),
  "stage"        varchar(32) NOT NULL,
  "verdict"      varchar(32) NOT NULL,
  "findings"     jsonb       DEFAULT '[]'::jsonb,
  "payload"      jsonb       DEFAULT '{}'::jsonb,
  "storage_ref"  text,
  "latency_ms"   integer,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "imaging_user_idx"
  ON "imaging_analysis" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "imaging_consult_idx"
  ON "imaging_analysis" ("consult_id");


CREATE TABLE IF NOT EXISTS "consult_analysis" (
  "consult_id"              varchar(64) PRIMARY KEY,
  "user_id"                 varchar(64) NOT NULL,
  "chief_complaint"         text        NOT NULL,
  "top_condition"           text,
  "top_prob_x1000"          integer,
  "icd10"                   varchar(16),
  "specialty"               varchar(64),
  "differentials"           jsonb       DEFAULT '[]'::jsonb,
  "model_used"              varchar(128),
  "gauntlet_passed"         boolean     NOT NULL DEFAULT false,
  "validator_score_x1000"   integer,
  "safety_score_x1000"      integer,
  "privacy_score_x1000"     integer,
  "prescription_issued"     boolean     NOT NULL DEFAULT false,
  "payload"                 jsonb       DEFAULT '{}'::jsonb,
  "elapsed_ms"              integer,
  "created_at"              timestamptz NOT NULL DEFAULT now(),
  "updated_at"              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "consult_analysis_user_idx"
  ON "consult_analysis" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "consult_analysis_specialty_idx"
  ON "consult_analysis" ("specialty");
