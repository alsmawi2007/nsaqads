-- Phase I (Controlled Auto-Tuning): append-only log of every rule
-- threshold/disable change the auto-tuner applies. Powers rollback by run_id.

CREATE TYPE "RuleTuningChangeType" AS ENUM ('TIGHTEN_THRESHOLD', 'DISABLE_RULE');
CREATE TYPE "RuleTuningStatus" AS ENUM ('APPLIED', 'ROLLED_BACK');

CREATE TABLE "rule_tuning_logs" (
  "id"                    TEXT NOT NULL,
  "run_id"                TEXT NOT NULL,
  "org_id"                TEXT,
  "rule_id"               TEXT NOT NULL,
  "change_type"           "RuleTuningChangeType" NOT NULL,
  "field_name"            TEXT NOT NULL,
  "before_value"          JSONB NOT NULL,
  "after_value"           JSONB NOT NULL,
  "status"                "RuleTuningStatus" NOT NULL DEFAULT 'APPLIED',
  "triggered_by_user_id"  TEXT NOT NULL,
  "applied_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rolled_back_at"        TIMESTAMP(3),
  "rolled_back_by"        TEXT,
  "rationale"             JSONB NOT NULL,
  CONSTRAINT "rule_tuning_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rule_tuning_logs_run_id_idx"     ON "rule_tuning_logs" ("run_id");
CREATE INDEX "rule_tuning_logs_rule_id_idx"    ON "rule_tuning_logs" ("rule_id");
CREATE INDEX "rule_tuning_logs_org_id_idx"     ON "rule_tuning_logs" ("org_id");
CREATE INDEX "rule_tuning_logs_status_idx"     ON "rule_tuning_logs" ("status");
CREATE INDEX "rule_tuning_logs_applied_at_idx" ON "rule_tuning_logs" ("applied_at");

ALTER TABLE "rule_tuning_logs"
  ADD CONSTRAINT "rule_tuning_logs_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "optimizer_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rule_tuning_logs"
  ADD CONSTRAINT "rule_tuning_logs_triggered_by_user_id_fkey"
  FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rule_tuning_logs"
  ADD CONSTRAINT "rule_tuning_logs_rolled_back_by_fkey"
  FOREIGN KEY ("rolled_back_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
