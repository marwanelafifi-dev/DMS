-- =============================================================================
-- Add local password auth support for non-SSO users.
--
-- dms_users already had sso_subject (Google Workspace) but no way for a
-- locally-created user to authenticate with a password. This adds a nullable
-- password_hash column (PBKDF2, see api/Services/PasswordHasher.cs) — null
-- means the account is SSO-only.
--
-- NOTE: like 003_dev_seed_admin.sql, this only auto-runs on a brand-new empty
-- Postgres data volume. If the volume already has data, run this ALTER
-- manually against the running container.
-- =============================================================================

ALTER TABLE dms_users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
