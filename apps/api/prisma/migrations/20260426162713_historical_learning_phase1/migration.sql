-- ─── Historical Learning Layer (Phase 1) ────────────────────────────────────
-- Adds enums, columns, and four new tables to support the HLL Phase 1 MVP.
-- Local-only migration; production deploy gated by Phase 1 stability.

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE "DataQuality" AS ENUM ('CLEAN', 'OUTLIER_FILTERED', 'SUSPECT');

CREATE TYPE "SampleSizeBand" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT');

CREATE TYPE "FeatureConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT', 'WARM_START');

CREATE TYPE "FeatureRunStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED');

CREATE TYPE "FeatureRunTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'BACKFILL');

CREATE TYPE "OutcomeFunnelStage" AS ENUM ('TOF', 'MOF', 'BOF', 'LOCAL');

CREATE TYPE "OutcomeAudienceType" AS ENUM ('COLD_INTEREST', 'COLD_BROAD', 'LOOKALIKE', 'CUSTOM', 'RETARGETING', 'ENGAGEMENT', 'UNKNOWN');

CREATE TYPE "OutcomeCreativeType" AS ENUM ('VERTICAL_VIDEO', 'SQUARE_VIDEO', 'HORIZONTAL_VIDEO', 'STATIC_IMAGE', 'CAROUSEL', 'COLLECTION', 'DPA', 'AR_LENS', 'STORY', 'UNKNOWN');

CREATE TYPE "OutcomeLanguage" AS ENUM ('AR', 'EN', 'AR_EN_MIXED', 'UNKNOWN');

CREATE TYPE "ScoringSkippedReason" AS ENUM ('LOW_SAMPLE', 'STALE', 'INSUFFICIENT_CONF', 'BAD_VALUE', 'STALE_INGESTION', 'NULL_FEATURE', 'WARM_START_INVALID', 'HLL_DISABLED', 'ORG_NOT_CANARY');

-- ─── metric_snapshots: data_quality column ───────────────────────────────────

ALTER TABLE "metric_snapshots"
  ADD COLUMN "data_quality" "DataQuality" NOT NULL DEFAULT 'CLEAN';

-- ─── campaign_plan_items: history_explanation column ─────────────────────────

ALTER TABLE "campaign_plan_items"
  ADD COLUMN "history_explanation" JSONB;

-- ─── campaign_outcomes ───────────────────────────────────────────────────────

CREATE TABLE "campaign_outcomes" (
  "id"                TEXT                  NOT NULL,
  "org_id"            TEXT                  NOT NULL,
  "campaign_plan_id"  TEXT,
  "campaign_id"       TEXT,
  "platform"          "Platform"            NOT NULL,
  "goal"              "CampaignGoal"        NOT NULL,
  "funnel_stage"      "OutcomeFunnelStage"  NOT NULL,
  "audience_type"     "OutcomeAudienceType" NOT NULL DEFAULT 'UNKNOWN',
  "creative_type"     "OutcomeCreativeType" NOT NULL DEFAULT 'UNKNOWN',
  "language"          "OutcomeLanguage"     NOT NULL DEFAULT 'UNKNOWN',
  "vertical"          TEXT,
  "geo_country"       TEXT,
  "geo_region"        TEXT,
  "started_at"        TIMESTAMP(3)          NOT NULL,
  "ended_at"          TIMESTAMP(3)          NOT NULL,
  "duration_days"     INTEGER               NOT NULL,
  "spend"             DECIMAL(15,4)         NOT NULL DEFAULT 0,
  "impressions"       BIGINT                NOT NULL DEFAULT 0,
  "clicks"            BIGINT                NOT NULL DEFAULT 0,
  "conversions"       BIGINT                NOT NULL DEFAULT 0,
  "revenue"           DECIMAL(15,4)         NOT NULL DEFAULT 0,
  "ctr"               DECIMAL(10,6)         NOT NULL DEFAULT 0,
  "cpc"               DECIMAL(15,4)         NOT NULL DEFAULT 0,
  "cpa"               DECIMAL(15,4)         NOT NULL DEFAULT 0,
  "roas"              DECIMAL(10,4)         NOT NULL DEFAULT 0,
  "cpm"               DECIMAL(15,4)         NOT NULL DEFAULT 0,
  "data_quality"      "DataQuality"         NOT NULL DEFAULT 'CLEAN',
  "outlier_flags"     JSONB                 NOT NULL DEFAULT '[]',
  "sealed_at"         TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"        TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "campaign_outcomes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "campaign_outcomes_org_id_platform_ended_at_idx"
  ON "campaign_outcomes" ("org_id", "platform", "ended_at");

CREATE INDEX "campaign_outcomes_org_id_vertical_geo_country_platform_idx"
  ON "campaign_outcomes" ("org_id", "vertical", "geo_country", "platform");

CREATE INDEX "campaign_outcomes_campaign_plan_id_idx"
  ON "campaign_outcomes" ("campaign_plan_id");

CREATE INDEX "campaign_outcomes_ended_at_idx"
  ON "campaign_outcomes" ("ended_at");

ALTER TABLE "campaign_outcomes"
  ADD CONSTRAINT "campaign_outcomes_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── org_features ────────────────────────────────────────────────────────────

CREATE TABLE "org_features" (
  "id"                    TEXT                NOT NULL,
  "org_id"                TEXT,
  "feature_name"          TEXT                NOT NULL,
  "feature_version"       INTEGER             NOT NULL DEFAULT 1,
  "dimensions"            JSONB               NOT NULL DEFAULT '{}',
  "dimensions_key"        TEXT                NOT NULL,
  "window_days"           INTEGER             NOT NULL,
  "value"                 DECIMAL(15,6),
  "numerator"             DECIMAL(20,6),
  "denominator"           DECIMAL(20,6),
  "sample_size"           INTEGER             NOT NULL DEFAULT 0,
  "sample_band"           "SampleSizeBand"    NOT NULL DEFAULT 'INSUFFICIENT',
  "confidence"            "FeatureConfidence" NOT NULL DEFAULT 'INSUFFICIENT',
  "is_warm_start"         BOOLEAN             NOT NULL DEFAULT false,
  "is_stale"              BOOLEAN             NOT NULL DEFAULT false,
  "computed_at"           TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "computed_from_run_id"  TEXT,
  "metadata"              JSONB,
  "created_at"            TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3)        NOT NULL,

  CONSTRAINT "org_features_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "org_features_org_id_feature_name_dimensions_key_window_days_feature_version_key"
  ON "org_features" ("org_id", "feature_name", "dimensions_key", "window_days", "feature_version");

CREATE INDEX "org_features_org_id_feature_name_window_days_computed_at_idx"
  ON "org_features" ("org_id", "feature_name", "window_days", "computed_at");

CREATE INDEX "org_features_is_stale_computed_at_idx"
  ON "org_features" ("is_stale", "computed_at");

CREATE INDEX "org_features_feature_name_feature_version_idx"
  ON "org_features" ("feature_name", "feature_version");

ALTER TABLE "org_features"
  ADD CONSTRAINT "org_features_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── feature_compute_runs ────────────────────────────────────────────────────

CREATE TABLE "feature_compute_runs" (
  "id"                TEXT                 NOT NULL,
  "org_id"            TEXT,
  "trigger"           "FeatureRunTrigger"  NOT NULL DEFAULT 'SCHEDULED',
  "status"            "FeatureRunStatus"   NOT NULL DEFAULT 'SUCCESS',
  "started_at"        TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at"       TIMESTAMP(3),
  "duration_ms"       INTEGER,
  "features_written"  INTEGER              NOT NULL DEFAULT 0,
  "features_skipped"  INTEGER              NOT NULL DEFAULT 0,
  "error_message"     TEXT,
  "context"           JSONB,

  CONSTRAINT "feature_compute_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "feature_compute_runs_org_id_started_at_idx"
  ON "feature_compute_runs" ("org_id", "started_at" DESC);

CREATE INDEX "feature_compute_runs_status_started_at_idx"
  ON "feature_compute_runs" ("status", "started_at");

ALTER TABLE "feature_compute_runs"
  ADD CONSTRAINT "feature_compute_runs_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── platform_scoring_decisions ──────────────────────────────────────────────

CREATE TABLE "platform_scoring_decisions" (
  "id"                       TEXT                    NOT NULL,
  "org_id"                   TEXT                    NOT NULL,
  "campaign_plan_id"         TEXT,
  "plan_synthesis_run_id"    TEXT                    NOT NULL,
  "platform"                 "Platform"              NOT NULL,
  "goal"                     "CampaignGoal"          NOT NULL,
  "funnel_stage"             "FunnelStage"           NOT NULL,
  "base_fitness"             DECIMAL(10,6)           NOT NULL,
  "multiplier"               DECIMAL(10,6),
  "multiplier_clamped"       BOOLEAN                 NOT NULL DEFAULT false,
  "final_score"              DECIMAL(10,6)           NOT NULL,
  "hll_applied"              BOOLEAN                 NOT NULL DEFAULT false,
  "skipped_reason"           "ScoringSkippedReason",
  "features_used"            JSONB                   NOT NULL DEFAULT '[]',
  "confidence_summary"       JSONB,
  "explanation"              JSONB,
  "decided_at"               TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "platform_scoring_decisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_scoring_decisions_org_id_decided_at_idx"
  ON "platform_scoring_decisions" ("org_id", "decided_at" DESC);

CREATE INDEX "platform_scoring_decisions_campaign_plan_id_idx"
  ON "platform_scoring_decisions" ("campaign_plan_id");

CREATE INDEX "platform_scoring_decisions_plan_synthesis_run_id_idx"
  ON "platform_scoring_decisions" ("plan_synthesis_run_id");

CREATE INDEX "platform_scoring_decisions_platform_decided_at_idx"
  ON "platform_scoring_decisions" ("platform", "decided_at");

ALTER TABLE "platform_scoring_decisions"
  ADD CONSTRAINT "platform_scoring_decisions_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "platform_scoring_decisions"
  ADD CONSTRAINT "platform_scoring_decisions_campaign_plan_id_fkey"
  FOREIGN KEY ("campaign_plan_id") REFERENCES "campaign_plans"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
