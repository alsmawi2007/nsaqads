-- CreateEnum
CREATE TYPE "PreferredLang" AS ENUM ('ar', 'en');

-- CreateEnum
CREATE TYPE "OrgPlan" AS ENUM ('FREE', 'STARTER', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('META', 'TIKTOK', 'GOOGLE_ADS', 'SNAPCHAT');

-- CreateEnum
CREATE TYPE "AdAccountStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISCONNECTED', 'ERROR', 'MOCK');

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED');

-- CreateEnum
CREATE TYPE "CampaignPhase" AS ENUM ('LEARNING', 'STABLE', 'SCALING', 'DEGRADED');

-- CreateEnum
CREATE TYPE "OptimizerMode" AS ENUM ('OFF', 'SUGGEST_ONLY', 'AUTO_APPLY');

-- CreateEnum
CREATE TYPE "RuleFamily" AS ENUM ('BUDGET', 'BIDDING_STRATEGY', 'BID_LIMIT');

-- CreateEnum
CREATE TYPE "RuleComparator" AS ENUM ('GT', 'LT', 'GTE', 'LTE', 'EQ');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('INCREASE_BUDGET', 'DECREASE_BUDGET', 'SWITCH_BIDDING_STRATEGY', 'ADJUST_BID_CEILING', 'ADJUST_BID_FLOOR');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'APPLIED', 'FAILED', 'SKIPPED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "TriggeredBy" AS ENUM ('SCHEDULER', 'MANUAL', 'API');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('BUDGET_EXHAUSTED', 'HIGH_CPA', 'LOW_ROAS', 'DELIVERY_ISSUE', 'OPTIMIZER_BLOCKED', 'TOKEN_EXPIRY', 'OPTIMIZER_ERROR', 'LEARNING_STALLED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PlatformScope" AS ENUM ('ALL', 'META', 'TIKTOK', 'GOOGLE_ADS', 'SNAPCHAT');

-- CreateEnum
CREATE TYPE "PhaseScope" AS ENUM ('ALL', 'STABLE', 'SCALING', 'DEGRADED');

-- CreateEnum
CREATE TYPE "SettingValueType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'JSON');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "avatar_url" TEXT,
    "preferred_lang" "PreferredLang" NOT NULL DEFAULT 'en',
    "is_system_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo_url" TEXT,
    "plan" "OrgPlan" NOT NULL DEFAULT 'FREE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL,
    "invited_by" TEXT,
    "joined_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_accounts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "status" "AdAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_synced_at" TIMESTAMP(3),
    "error_message" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "status" "EntityStatus" NOT NULL,
    "objective" TEXT,
    "daily_budget" DECIMAL(15,4),
    "lifetime_budget" DECIMAL(15,4),
    "is_cbo" BOOLEAN NOT NULL DEFAULT false,
    "start_date" DATE,
    "end_date" DATE,
    "campaign_phase" "CampaignPhase" NOT NULL DEFAULT 'LEARNING',
    "optimizer_mode" "OptimizerMode" NOT NULL DEFAULT 'SUGGEST_ONLY',
    "phase_updated_at" TIMESTAMP(3),
    "optimizer_enabled" BOOLEAN NOT NULL DEFAULT true,
    "synced_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_sets" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "EntityStatus" NOT NULL,
    "daily_budget" DECIMAL(15,4),
    "bidding_strategy" TEXT,
    "bid_amount" DECIMAL(15,4),
    "bid_floor" DECIMAL(15,4),
    "bid_ceiling" DECIMAL(15,4),
    "optimizer_mode" "OptimizerMode" NOT NULL DEFAULT 'SUGGEST_ONLY',
    "optimizer_enabled" BOOLEAN NOT NULL DEFAULT true,
    "synced_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_snapshots" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "window_hours" INTEGER NOT NULL,
    "spend" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "ctr" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "cpc" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "conversions" BIGINT NOT NULL DEFAULT 0,
    "cpa" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "revenue" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "roas" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "reach" BIGINT NOT NULL DEFAULT 0,
    "frequency" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "spend_pacing" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "optimizer_rules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT,
    "rule_family" "RuleFamily" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "kpi_metric" TEXT NOT NULL,
    "comparator" "RuleComparator" NOT NULL,
    "threshold_value" DECIMAL(15,6) NOT NULL,
    "consecutive_windows" INTEGER NOT NULL DEFAULT 1,
    "action_type" "ActionType" NOT NULL,
    "action_delta" DECIMAL(10,4),
    "action_target_value" TEXT,
    "max_delta_per_cycle" DECIMAL(10,4),
    "min_sample_impressions" BIGINT NOT NULL DEFAULT 1000,
    "platform_scope" "PlatformScope" NOT NULL DEFAULT 'ALL',
    "applies_to_phase" "PhaseScope" NOT NULL DEFAULT 'ALL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "optimizer_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "optimizer_actions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "rule_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "action_type" "ActionType" NOT NULL,
    "before_value" JSONB NOT NULL,
    "after_value" JSONB NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "applied_at" TIMESTAMP(3),
    "error_message" TEXT,
    "triggered_by" "TriggeredBy" NOT NULL DEFAULT 'SCHEDULER',
    "triggered_by_user_id" TEXT,
    "evaluation_context" JSONB,
    "explanation" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "optimizer_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cooldown_trackers" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "last_action_at" TIMESTAMP(3) NOT NULL,
    "cooldown_hours" INTEGER NOT NULL DEFAULT 24,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cooldown_trackers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "alert_type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "dedup_key" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "routed_via" JSONB NOT NULL DEFAULT '[]',
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "before_state" JSONB,
    "after_state" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_settings" (
    "id" TEXT NOT NULL,
    "org_id" TEXT,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "memberships_org_id_idx" ON "memberships"("org_id");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_org_id_user_id_key" ON "memberships"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "ad_accounts_org_id_idx" ON "ad_accounts"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_accounts_org_id_platform_external_id_key" ON "ad_accounts"("org_id", "platform", "external_id");

-- CreateIndex
CREATE INDEX "campaigns_org_id_idx" ON "campaigns"("org_id");

-- CreateIndex
CREATE INDEX "campaigns_ad_account_id_idx" ON "campaigns"("ad_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_ad_account_id_external_id_key" ON "campaigns"("ad_account_id", "external_id");

-- CreateIndex
CREATE INDEX "ad_sets_org_id_idx" ON "ad_sets"("org_id");

-- CreateIndex
CREATE INDEX "ad_sets_campaign_id_idx" ON "ad_sets"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_sets_campaign_id_external_id_key" ON "ad_sets"("campaign_id", "external_id");

-- CreateIndex
CREATE INDEX "metric_snapshots_org_id_idx" ON "metric_snapshots"("org_id");

-- CreateIndex
CREATE INDEX "metric_snapshots_entity_type_entity_id_idx" ON "metric_snapshots"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "metric_snapshots_snapshot_date_idx" ON "metric_snapshots"("snapshot_date");

-- CreateIndex
CREATE UNIQUE INDEX "metric_snapshots_entity_type_entity_id_snapshot_date_window_key" ON "metric_snapshots"("entity_type", "entity_id", "snapshot_date", "window_hours");

-- CreateIndex
CREATE INDEX "optimizer_rules_org_id_idx" ON "optimizer_rules"("org_id");

-- CreateIndex
CREATE INDEX "optimizer_rules_rule_family_idx" ON "optimizer_rules"("rule_family");

-- CreateIndex
CREATE INDEX "optimizer_rules_is_enabled_idx" ON "optimizer_rules"("is_enabled");

-- CreateIndex
CREATE INDEX "optimizer_actions_org_id_idx" ON "optimizer_actions"("org_id");

-- CreateIndex
CREATE INDEX "optimizer_actions_entity_type_entity_id_idx" ON "optimizer_actions"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "optimizer_actions_status_idx" ON "optimizer_actions"("status");

-- CreateIndex
CREATE INDEX "optimizer_actions_created_at_idx" ON "optimizer_actions"("created_at");

-- CreateIndex
CREATE INDEX "cooldown_trackers_expires_at_idx" ON "cooldown_trackers"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "cooldown_trackers_entity_type_entity_id_action_type_key" ON "cooldown_trackers"("entity_type", "entity_id", "action_type");

-- CreateIndex
CREATE INDEX "alerts_org_id_idx" ON "alerts"("org_id");

-- CreateIndex
CREATE INDEX "alerts_entity_type_entity_id_idx" ON "alerts"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "alerts_is_read_idx" ON "alerts"("is_read");

-- CreateIndex
CREATE INDEX "alerts_created_at_idx" ON "alerts"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_org_id_idx" ON "audit_logs"("org_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "admin_settings_org_id_idx" ON "admin_settings"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_settings_org_id_key_key" ON "admin_settings"("org_id", "key");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "optimizer_rules" ADD CONSTRAINT "optimizer_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "optimizer_actions" ADD CONSTRAINT "optimizer_actions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "optimizer_actions" ADD CONSTRAINT "optimizer_actions_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "optimizer_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "optimizer_actions" ADD CONSTRAINT "optimizer_actions_triggered_by_user_id_fkey" FOREIGN KEY ("triggered_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cooldown_trackers" ADD CONSTRAINT "cooldown_trackers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_settings" ADD CONSTRAINT "admin_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_settings" ADD CONSTRAINT "admin_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

