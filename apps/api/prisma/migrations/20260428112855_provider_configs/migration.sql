-- Provider configs: SYSTEM_ADMIN-managed OAuth + API credentials per platform.
-- Replaces env-based provider keys. Secrets stored AES-256-GCM encrypted.

CREATE TABLE "provider_configs" (
    "id"                          TEXT        NOT NULL,
    "platform"                    "Platform"  NOT NULL,
    "is_enabled"                  BOOLEAN     NOT NULL DEFAULT false,
    "app_id"                      TEXT        NOT NULL,
    "app_secret_cipher"           TEXT        NOT NULL,
    "redirect_uri"                TEXT        NOT NULL,
    "oauth_state_secret_cipher"   TEXT        NOT NULL,
    "api_version"                 TEXT,
    "scopes"                      TEXT[]      DEFAULT ARRAY[]::TEXT[],
    "extra"                       JSONB,
    "key_version"                 INTEGER     NOT NULL DEFAULT 1,
    "updated_by"                  TEXT,
    "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_configs_platform_key" ON "provider_configs"("platform");

ALTER TABLE "provider_configs"
    ADD CONSTRAINT "provider_configs_updated_by_fkey"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
