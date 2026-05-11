-- Phase F (Insight Audit & Learning Metrics): denormalize insight metadata
-- onto the interaction row at write-time so analytics can aggregate by
-- insight_type / priority / rule / platform without re-deriving the insight
-- (which is ephemeral and never persisted).

ALTER TABLE "insight_interactions"
  ADD COLUMN "insight_type"        TEXT,
  ADD COLUMN "severity"            TEXT,
  ADD COLUMN "priority"            TEXT,
  ADD COLUMN "related_rule_id"     TEXT,
  ADD COLUMN "related_action_type" "ActionType",
  ADD COLUMN "platform"            "Platform",
  ADD COLUMN "entity_type"         TEXT,
  ADD COLUMN "entity_id"           TEXT;

-- Indexes targeted at the common analytics group-bys.
CREATE INDEX "insight_interactions_org_id_insight_type_idx"
  ON "insight_interactions" ("org_id", "insight_type");

CREATE INDEX "insight_interactions_org_id_related_rule_id_idx"
  ON "insight_interactions" ("org_id", "related_rule_id");

CREATE INDEX "insight_interactions_org_id_platform_idx"
  ON "insight_interactions" ("org_id", "platform");
