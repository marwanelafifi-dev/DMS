-- Migration 031: Assignable global user roles
-- Adds a real, directly-editable "role" to each user (shown/edited as the
-- "Access" column on the Users admin page), backed by the same
-- dms_role_permissions catalog already used by RBACMiddleware. Unlike the old
-- "highest folder-permission grant" summary this replaces, this is an actual
-- stored assignment — an admin can pick any existing role or a newly created
-- one directly on the Users page.
--
-- Like 003/004/005, this only auto-runs on a brand-new empty Postgres volume.
-- On an existing database, apply manually:
--   docker compose exec -T postgres psql -U dms_app -d dms -f /path/to/this/file

ALTER TABLE dms_users
    ADD COLUMN IF NOT EXISTS role VARCHAR(50) REFERENCES dms_role_permissions(role) ON DELETE SET NULL;

-- Backfill: give each existing user their current highest per-folder grant as
-- a starting global role, so nobody's "Access" column silently goes blank on
-- upgrade. Purely a one-time convenience; from here on the two are independent.
UPDATE dms_users u
SET role = sub.role
FROM (
    SELECT DISTINCT ON (user_id) user_id, role
    FROM dms_folder_permissions
    ORDER BY user_id, CASE role
        WHEN 'Admin' THEN 1
        WHEN 'QA' THEN 2
        WHEN 'Manager' THEN 3
        WHEN 'Writer' THEN 4
        WHEN 'Reader' THEN 5
        ELSE 6
    END
) sub
WHERE u.user_id = sub.user_id AND u.role IS NULL;
