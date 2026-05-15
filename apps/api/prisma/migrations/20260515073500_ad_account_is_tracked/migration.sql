-- Add opt-in tracking flag to ad_accounts.
-- OAuth flows pull every ad account the granted user can manage (often
-- hundreds). Active tracking — token refresh, metrics ingestion, campaign
-- sync — should only run on accounts the admin explicitly opts in.
-- Default false. Existing rows therefore become "untracked" on apply and
-- must be re-selected from the web UI.
ALTER TABLE "ad_accounts"
  ADD COLUMN "is_tracked" BOOLEAN NOT NULL DEFAULT false;

-- Index supports the "Tracked" / "Available" tab queries on /ad-accounts
-- and the scheduler's "find tracked accounts" lookups.
CREATE INDEX "ad_accounts_org_id_is_tracked_idx"
  ON "ad_accounts" ("org_id", "is_tracked");
