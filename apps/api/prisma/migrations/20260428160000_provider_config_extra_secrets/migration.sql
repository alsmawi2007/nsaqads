-- Encrypted bag for platform-specific sensitive credentials (e.g. Google Ads
-- developer-token). Same AES-256-GCM ciphertext format as app_secret_cipher.
-- The plaintext `extra` JSONB column remains for non-sensitive metadata
-- (e.g. login_customer_id) that is safe to surface on admin GET.

ALTER TABLE "provider_configs"
    ADD COLUMN "extra_secrets_cipher" TEXT;
