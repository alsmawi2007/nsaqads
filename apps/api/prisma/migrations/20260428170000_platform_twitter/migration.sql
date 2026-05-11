-- Adds TWITTER (X) as a supported platform.
--
-- This is a config-only addition: the Platform enum is extended so the
-- ProviderConfigsService can store X/Twitter OAuth credentials, and the
-- PlatformScope enum is extended so optimizer rules can target TWITTER once
-- the provider integration lands. No tables or rows are touched.

ALTER TYPE "Platform"      ADD VALUE 'TWITTER';
ALTER TYPE "PlatformScope" ADD VALUE 'TWITTER';
