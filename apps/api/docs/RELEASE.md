# Nasaq Ads Production Rollout — Meta Sandbox v0.1

This is the operational runbook for the first controlled production activation
of Nasaq Ads (نسق ادز). Scope is **Meta only**. Auto-tune stays off. Campaigns stay on
`SUGGEST_ONLY`. We are validating the end-to-end pipeline, not enabling
automation.

Every command runs against the deployed VPS API at `https://api.nsqads.ai`.
Replace `$TOKEN` with the SYSTEM_ADMIN bearer token.

> **Naming note:** The product is **Nasaq Ads** (نسق ادز). Some deployment
> identifiers below (ssh host `adari-vps`, install path `/opt/adari/`, pm2
> process `adari-api`, ops email `mohsen@adari.ai`) still carry the legacy
> prefix — those are infrastructure artifacts pending a separate ops
> migration, not source-code references.

---

## 0. Pre-flight invariants — must hold before anything else

| Invariant | How to verify | Why |
|---|---|---|
| `learning.auto_tune_enabled = false` | `GET /api/v1/health/readiness → guardrails.autoTuneEnabled` | Auto-tune writes back to optimizer rules. We are not ready. |
| Zero campaigns on `AUTO_APPLY` | `GET /api/v1/health/readiness → guardrails.autoApplyCampaignCount` | AUTO_APPLY campaigns will execute provider writes on the next optimizer cycle. |
| Schema default `optimizer_mode = SUGGEST_ONLY` | `prisma/schema.prisma` lines 423, 458 | New campaigns inherit the safe default. |
| `metrics.ingestion_enabled = true` | `GET /api/v1/health/readiness → ingestion.enabled` | Without it the cron exits before doing anything. |

`GET /api/v1/health/readiness` collapses all four into a single response —
`status: "ready"` is the green light. `status: "unsafe"` is a hard stop.

---

## 1. Pre-deploy — DB migrations + bootstrap

### 1.1 Migrations

```bash
ssh adari-vps
cd /opt/adari/apps/api
git pull origin main
pnpm install --frozen-lockfile
npx prisma migrate deploy
```

Expected output: `No pending migrations to apply.` or a list of applied
migrations. **Stop here if any migration fails.**

### 1.2 Verify env / bootstrap

```bash
# All five must be set; ENCRYPTION_KEY must be 32 bytes hex.
env | grep -E '^(DATABASE_URL|REDIS_URL|JWT_SECRET|JWT_REFRESH_SECRET|ENCRYPTION_KEY)='
```

### 1.3 Restart the API

```bash
pm2 restart adari-api
pm2 logs adari-api --lines 50
```

Look for:

```
[Nest] LOG [NestApplication] Nest application successfully started
[Nest] LOG [MetricsIngestionScheduler] Metrics ingestion scheduler initialized
[Nest] LOG [OptimizerScheduler] Optimizer scheduler initialized
```

---

## 2. SYSTEM_ADMIN verification

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.nsqads.ai/api/v1/auth/me | jq '.isSystemAdmin'
# → true
```

If `false`, set the flag in DB and re-issue the token:

```sql
UPDATE users SET is_system_admin = true WHERE email = 'mohsen@adari.ai';
```

---

## 3. ProviderConfig setup (Meta)

### 3.1 Confirm not already configured

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.nsqads.ai/api/v1/admin/provider-configs | jq
```

### 3.2 Upsert Meta credentials

```bash
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "isEnabled": true,
    "clientId": "<APP_ID>",
    "clientSecret": "<APP_SECRET>",
    "apiVersion": "v19.0",
    "redirectUri": "https://api.nsqads.ai/api/v1/providers/meta/oauth/callback"
  }' \
  https://api.nsqads.ai/api/v1/admin/provider-configs/META | jq
```

### 3.3 Confirm

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.nsqads.ai/api/v1/admin/provider-configs/META | jq
# Secrets must be redacted: "clientSecret": "***", non-null fields visible.
```

---

## 4. Meta OAuth flow (sandbox org)

### 4.1 Start

```bash
ORG_ID="<sandbox-org-uuid>"
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.nsqads.ai/api/v1/orgs/$ORG_ID/providers/meta/oauth/start" | jq
# Returns { authorizeUrl, state }
```

Open `authorizeUrl` in a browser, complete consent, redirect lands on the
`/callback` endpoint, AdAccount rows are written.

### 4.2 Verify the AdAccount

```sql
SELECT id, platform, name, status, last_synced_at, deleted_at
FROM ad_accounts
WHERE org_id = '<sandbox-org-uuid>' AND platform = 'META';
```

`status` should be `ACTIVE`, `deleted_at` NULL.

---

## 5. Sync campaigns

```bash
AD_ACCOUNT_ID="<from-step-4>"
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  "https://api.nsqads.ai/api/v1/orgs/$ORG_ID/ad-accounts/$AD_ACCOUNT_ID/sync" | jq
```

Verify:

```sql
SELECT id, name, optimizer_mode, campaign_phase, deleted_at
FROM campaigns
WHERE ad_account_id = '<AD_ACCOUNT_ID>'
ORDER BY created_at DESC;
```

Every campaign must show `optimizer_mode = SUGGEST_ONLY` (release guardrail).
If anything is `AUTO_APPLY`, **stop** and reset:

```sql
UPDATE campaigns SET optimizer_mode = 'SUGGEST_ONLY' WHERE optimizer_mode = 'AUTO_APPLY';
```

---

## 6. Manual ingestion run

### 6.1 Dry run (no provider calls)

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "orgId": "'$ORG_ID'", "dryRun": true, "note": "rollout dry run" }' \
  https://api.nsqads.ai/api/v1/admin/metrics/ingest/run | jq
```

Response should list every campaign with `succeeded: true`, `durationMs: 0`,
no `errorMessage`.

### 6.2 Live run

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "orgId": "'$ORG_ID'", "note": "rollout first live ingest" }' \
  https://api.nsqads.ai/api/v1/admin/metrics/ingest/run | jq
```

Expected: `succeededCount > 0`, `failedCount = 0`, `perPlatform[0].platform = "META"`.

### 6.3 Verify snapshots persisted

```sql
SELECT entity_type, COUNT(*), MAX(created_at)
FROM metric_snapshots
WHERE org_id = '<sandbox-org-uuid>'
GROUP BY entity_type;
```

Three rows per campaign (windows 24, 48, 72) per ingestion day.

### 6.4 Observability

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.nsqads.ai/api/v1/admin/metrics/ingest/observability?orgId=$ORG_ID" | jq
```

`recentRuns[0]` must reflect the run from step 6.2. `perAccountFreshness[].minutesSinceLastIngestion`
must be small (single digits).

---

## 7. Dashboard / intelligence validation

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.nsqads.ai/api/v1/orgs/$ORG_ID/dashboard/intelligence" | jq
```

Required fields populated:

- `health.totalActiveInsights` ≥ 0 (zero is fine the first day; rules need
  multiple windows to fire)
- `health.bySeverity` returns numeric counts
- `topInsights` array (may be empty initially)
- `ruleHealth.totalRules` matches `optimizer_rules` cardinality
- `simulation.isShadowMode` = `true`
- `autoTune.totalRuns` = 0 (auto-tune off — confirms guardrail)

---

## 8. Final readiness sweep

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://api.nsqads.ai/api/v1/health/readiness | jq
```

Sample shape:

```json
{
  "status": "ready",
  "blockers": [],
  "providerConfigs": { "configured": 1, "enabled": 1, "enabledPlatforms": ["META"] },
  "adAccounts": { "total": 1, "active": 1, "errored": 0, "disconnected": 0, "minutesSinceLastSync": 4, "lastSyncedAt": "..." },
  "ingestion": { "enabled": true, "intervalHours": 6, "minutesSinceLastIngestion": 2, "snapshotCount": 36, "lastIngestionAt": "..." },
  "intelligence": { "ruleCount": 12, "optimizerActionCount": 0, "ruleTuningLogCount": 0 },
  "guardrails": {
    "autoTuneEnabled": false,
    "autoApplyCampaignCount": 0,
    "suggestOnlyCampaignCount": 12,
    "optimizerOffCampaignCount": 0,
    "rolloutSafetyOk": true
  }
}
```

---

## 9. Smoke-test script — copy-paste, single block

```bash
TOKEN="$1"
ORG_ID="$2"
BASE="https://api.nsqads.ai/api/v1"

set -euo pipefail

echo "[1] liveness"
curl -fsSL "$BASE/health" | jq -r '.status'

echo "[2] readiness"
curl -fsSL -H "Authorization: Bearer $TOKEN" "$BASE/health/readiness" | jq '{status, blockers, guardrails}'

echo "[3] provider config (Meta)"
curl -fsSL -H "Authorization: Bearer $TOKEN" "$BASE/admin/provider-configs/META" | jq '{platform, isEnabled, apiVersion}'

echo "[4] ad accounts"
curl -fsSL -H "Authorization: Bearer $TOKEN" "$BASE/orgs/$ORG_ID/ad-accounts" \
  | jq '[.[] | {id, platform, status, lastSyncedAt}]'

echo "[5] dry-run ingestion"
curl -fsSL -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"orgId\":\"$ORG_ID\",\"dryRun\":true}" \
  "$BASE/admin/metrics/ingest/run" | jq '{succeededCount, failedCount, totalEntities}'

echo "[6] dashboard intelligence"
curl -fsSL -H "Authorization: Bearer $TOKEN" "$BASE/orgs/$ORG_ID/dashboard/intelligence" \
  | jq '{totalActiveInsights: .health.totalActiveInsights, autoTuneRuns: .autoTune.totalRuns, simulationShadow: .simulation.isShadowMode}'

echo "[7] ingestion observability"
curl -fsSL -H "Authorization: Bearer $TOKEN" "$BASE/admin/metrics/ingest/observability?orgId=$ORG_ID" \
  | jq '{ingestionEnabled, intervalHours, lastRunAt, perAccountFreshness: [.perAccountFreshness[] | {adAccountId, lastIngestedAt, minutesSinceLastIngestion}]}'

echo "OK"
```

Save as `scripts/rollout-smoke.sh`, run with `bash scripts/rollout-smoke.sh "$TOKEN" "$ORG_ID"`.

---

## 10. Failure checklist

| Symptom | Likely cause | First action |
|---|---|---|
| `readiness.status = "unsafe"` and `autoApplyCampaignCount > 0` | A campaign was promoted to AUTO_APPLY | `UPDATE campaigns SET optimizer_mode='SUGGEST_ONLY' WHERE optimizer_mode='AUTO_APPLY'` then re-check |
| `readiness.status = "unsafe"` and `autoTuneEnabled = true` | learning.auto_tune_enabled flipped on | `PUT /admin/settings/learning.auto_tune_enabled` with body `{"value": false}` |
| OAuth start returns `VALIDATION: Provider META is not configured` | ProviderConfig row missing or `isEnabled: false` | Re-run step 3.2 |
| OAuth callback returns 500, AdAccount not written | Mismatched `redirectUri` between Meta dashboard and ProviderConfig | Align both, retry |
| Sync returns 0 campaigns | Token has no ad-account permissions, or sandbox app has no campaigns | Check Meta sandbox; re-OAuth with broader scopes |
| Ingest returns `failedCount > 0` with `Provider 401` | `accessToken` expired between OAuth and ingest | Trigger token refresh: `POST /orgs/:orgId/ad-accounts/:id/sync` (refreshes on 401) |
| `metric_snapshots` rows zero after ingest with `succeeded: true` | Same-day idempotency hit — already ingested | Confirm with `SELECT COUNT(*) FROM metric_snapshots WHERE snapshot_date = CURRENT_DATE` |
| `dashboard/intelligence` returns `totalActiveInsights = 0` | Rules need 24h/48h/72h windows of data; expected on day 1 | Wait one ingestion cycle, re-check |
| Scheduler not firing | `metrics.ingestion_enabled = false` OR last run within `intervalHours` | Inspect `pm2 logs` for "skipping cycle" lines |

---

## 11. Go / No-Go

### GO when **all** of these hold

- `health.status = "ready"` (or `degraded` only because no insights have fired yet — `health.totalActiveInsights = 0` is acceptable on day 1)
- `readiness.guardrails.rolloutSafetyOk = true`
- `readiness.providerConfigs.enabledPlatforms = ["META"]` (and only META)
- `readiness.adAccounts.active ≥ 1`
- `readiness.ingestion.lastIngestionAt` within the last `intervalHours`
- All sandbox campaigns visible in dashboard/intelligence response
- Smoke-test script (section 9) exits 0

### NO-GO when **any** of these hold

- `readiness.status = "unsafe"` for **any** reason — never override
- Any platform other than META in `providerConfigs.enabledPlatforms`
- Any campaign in `optimizer_mode = AUTO_APPLY`
- `learning.auto_tune_enabled = true`
- `ingestion.failedCount > 0` on the first live run
- AdAccount in `ERROR` or `DISCONNECTED` status
- Migration step 1.1 reported any failure

---

## 12. Out of scope for this rollout

These are intentionally **not** activated. Re-introduce only after the
sandbox week passes:

- AUTO_APPLY mode for any campaign
- `learning.auto_tune_enabled = true`
- TikTok / Snapchat / Google Ads provider configs (rows can exist but
  `isEnabled` must remain `false`)
- New intelligence / scoring features
- Provider-side write operations triggered manually
- Cron frequency changes below 6h
