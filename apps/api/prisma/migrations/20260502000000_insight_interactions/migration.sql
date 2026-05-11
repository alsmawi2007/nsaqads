-- Insight interactions: per-user lifecycle and feedback on computed insights.
--
-- Insights are computed on-demand and never persisted, so this table does NOT
-- foreign-key back to an insight row. The insight_id column stores the
-- deterministic SHA-1-derived id produced by InsightsService — stable across
-- requests as long as the underlying entity is identifiable.
--
-- One row per (insight_id, user_id), holding the latest status + feedback.
-- Mutations are last-write-wins: marking SEEN then later DISMISSED replaces
-- the row's status, so the dashboard surfaces only the current state.

CREATE TYPE "InsightInteractionStatus" AS ENUM ('SEEN', 'DISMISSED', 'SAVED');

CREATE TYPE "InsightFeedback" AS ENUM ('USEFUL', 'NOT_USEFUL', 'WRONG', 'NEEDS_MORE_CONTEXT');

CREATE TABLE "insight_interactions" (
    "id"         TEXT                          NOT NULL,
    "insight_id" TEXT                          NOT NULL,
    "org_id"     TEXT                          NOT NULL,
    "user_id"    TEXT                          NOT NULL,
    "status"     "InsightInteractionStatus",
    "feedback"   "InsightFeedback",
    "note"       TEXT,
    "created_at" TIMESTAMP(3)                  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3)                  NOT NULL,

    CONSTRAINT "insight_interactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "insight_interactions_insight_id_user_id_key"
  ON "insight_interactions" ("insight_id", "user_id");

CREATE INDEX "insight_interactions_org_id_user_id_idx"
  ON "insight_interactions" ("org_id", "user_id");

CREATE INDEX "insight_interactions_insight_id_idx"
  ON "insight_interactions" ("insight_id");

ALTER TABLE "insight_interactions"
  ADD CONSTRAINT "insight_interactions_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "insight_interactions"
  ADD CONSTRAINT "insight_interactions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
