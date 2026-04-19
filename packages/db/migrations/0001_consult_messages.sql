-- Migration 0001 — consult_messages
--
-- Promotes consult continuity from localStorage-only to durable
-- Postgres storage. Same per-user isolation as activity_log; queries
-- always scope by user_id. Indexed for the two read patterns:
--   1. (consult_id, ts)  — replay one conversation oldest-first
--   2. (user_id,    ts)  — list newest consults for a user

CREATE TABLE IF NOT EXISTS "consult_messages" (
  "id"         text         PRIMARY KEY,
  "consult_id" varchar(64)  NOT NULL,
  "user_id"    varchar(64)  NOT NULL,
  "ts"         bigint       NOT NULL,
  "role"       varchar(32)  NOT NULL,
  "text"       text         NOT NULL,
  "meta"       jsonb
);

CREATE INDEX IF NOT EXISTS "consult_msg_consult_idx"
  ON "consult_messages" ("consult_id", "ts");

CREATE INDEX IF NOT EXISTS "consult_msg_user_idx"
  ON "consult_messages" ("user_id", "ts");
