-- =============================================================================
-- Dev-only seed: bootstrap admin user
--
-- The RBAC middleware requires a valid, active dms_users row for the
-- X-User-Id header on every protected endpoint (see RBACMiddleware.cs).
-- With an empty users table there is no way to create the first user via
-- the API, since POST /api/users is itself gated behind that same check.
--
-- This inserts one fixed-GUID admin so the frontend has a real user to
-- authenticate as until Google Workspace SSO (see CLAUDE.md roadmap) is
-- wired up. Remove this file once real login exists.
-- =============================================================================

INSERT INTO dms_users (user_id, email, full_name, is_active, created_at, updated_at)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'admin@si-ware.com',
    'System Admin',
    TRUE,
    now(),
    now()
)
ON CONFLICT (user_id) DO NOTHING;
