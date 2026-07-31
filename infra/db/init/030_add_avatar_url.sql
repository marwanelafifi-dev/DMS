-- =============================================================================
-- Google Sign-In returns a profile photo URL alongside email/name — store it
-- so the UI can render a real avatar instead of always falling back to
-- initials. Null for local (password-only) accounts.
--
-- NOTE: like 004_add_password_hash.sql, this only auto-runs on a brand-new
-- empty Postgres data volume. If the volume already has data, run this ALTER
-- manually against the running container.
-- =============================================================================

ALTER TABLE dms_users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);
