-- CreateEnum
CREATE TYPE "CampaignPlanStatus" AS ENUM ('DRAFT', 'APPROVED', 'LAUNCHING', 'LAUNCHED', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CampaignPlanItemLaunchStatus" AS ENUM ('PENDING', 'CREATING', 'CREATED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CampaignGoal" AS ENUM ('AWARENESS', 'TRAFFIC', 'ENGAGEMENT', 'LEADS', 'SALES', 'APP_INSTALLS');

-- CreateEnum
CREATE TYPE "FunnelStage" AS ENUM ('TOFU', 'MOFU', 'BOFU');

-- CreateEnum
CREATE TYPE "BudgetType" AS ENUM ('DAILY', 'LIFETIME');

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "source_plan_id" TEXT;

-- AlterTable
ALTER TABLE "ad_sets" ADD COLUMN     "source_plan_item_id" TEXT;

-- CreateTable
CREATE TABLE "campaign_plans" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "status" "CampaignPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "goal" "CampaignGoal" NOT NULL,
    "funnel_stage" "FunnelStage" NOT NULL,
    "total_budget" DECIMAL(15,4) NOT NULL,
    "budget_type" "BudgetType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "geography" JSONB NOT NULL,
    "audience_hints" JSONB,
    "creative_brief" JSONB NOT NULL,
    "wizard_answers" JSONB NOT NULL,
    "reasoning" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "risks" JSONB NOT NULL DEFAULT '[]',
    "warnings_acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "launched_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_plan_items" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "daily_budget" DECIMAL(15,4) NOT NULL,
    "is_cbo" BOOLEAN NOT NULL DEFAULT false,
    "bidding_strategy" TEXT NOT NULL,
    "bid_target" DECIMAL(15,4),
    "audience" JSONB NOT NULL,
    "creative_ref" JSONB NOT NULL,
    "launch_status" "CampaignPlanItemLaunchStatus" NOT NULL DEFAULT 'PENDING',
    "external_campaign_id" TEXT,
    "external_adset_ids" JSONB,
    "error_message" TEXT,
    "launched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_plans_org_id_idx" ON "campaign_plans"("org_id");

-- CreateIndex
CREATE INDEX "campaign_plans_status_idx" ON "campaign_plans"("status");

-- CreateIndex
CREATE INDEX "campaign_plans_created_at_idx" ON "campaign_plans"("created_at");

-- CreateIndex
CREATE INDEX "campaign_plan_items_plan_id_idx" ON "campaign_plan_items"("plan_id");

-- CreateIndex
CREATE INDEX "campaign_plan_items_launch_status_idx" ON "campaign_plan_items"("launch_status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_plan_items_plan_id_platform_key" ON "campaign_plan_items"("plan_id", "platform");

-- CreateIndex
CREATE INDEX "campaigns_source_plan_id_idx" ON "campaigns"("source_plan_id");

-- CreateIndex
CREATE INDEX "ad_sets_source_plan_item_id_idx" ON "ad_sets"("source_plan_item_id");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_source_plan_id_fkey" FOREIGN KEY ("source_plan_id") REFERENCES "campaign_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_source_plan_item_id_fkey" FOREIGN KEY ("source_plan_item_id") REFERENCES "campaign_plan_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_plans" ADD CONSTRAINT "campaign_plans_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_plans" ADD CONSTRAINT "campaign_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_plans" ADD CONSTRAINT "campaign_plans_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_plan_items" ADD CONSTRAINT "campaign_plan_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "campaign_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_plan_items" ADD CONSTRAINT "campaign_plan_items_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

