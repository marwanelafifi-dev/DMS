-- Migration 038: Split global user role into pure page/feature access
-- Per explicit request: the global role assigned to a user (dms_users.role)
-- stops governing file/folder actions entirely (upload/delete/rename/etc. —
-- those remain the job of per-folder grants in dms_folder_permissions plus
-- the File/Folder Permission overrides in dms_access_overrides). The global
-- role becomes a simple page/feature visibility switch with 5 named roles:
-- User, Manager, Quality, Auditor, Full Access.
-- Date: 2026-08-01

CREATE TABLE IF NOT EXISTS dms_page_access_roles (
    role VARCHAR(50) PRIMARY KEY,
    can_view_dashboard BOOLEAN NOT NULL DEFAULT true,
    can_view_document_library BOOLEAN NOT NULL DEFAULT true,
    can_view_reminders BOOLEAN NOT NULL DEFAULT true,
    can_view_approvals BOOLEAN NOT NULL DEFAULT false,
    can_view_pcar BOOLEAN NOT NULL DEFAULT false,
    can_view_admin_panel BOOLEAN NOT NULL DEFAULT false,
    -- A "super admin" style bypass: this role's holders get full access to
    -- every folder's content even with no explicit per-folder grant. Only
    -- Full Access has this by default.
    bypass_folder_permissions BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO dms_page_access_roles (role, can_view_dashboard, can_view_document_library, can_view_reminders, can_view_approvals, can_view_pcar, can_view_admin_panel, bypass_folder_permissions)
VALUES
    ('User', true, true, true, false, false, false, false),
    ('Manager', true, true, true, true, false, false, false),
    ('Quality', true, true, true, false, true, false, false),
    ('Auditor', true, true, true, false, true, false, false),
    ('Full Access', true, true, true, true, true, true, true)
ON CONFLICT (role) DO NOTHING;

-- Drop the old FK (to dms_role_permissions) *before* remapping values below —
-- otherwise the UPDATE itself violates the still-active old constraint the
-- moment it writes a name (e.g. "User") that only exists in the new catalog.
ALTER TABLE dms_users DROP CONSTRAINT IF EXISTS dms_users_role_fkey;

-- Remap existing dms_users.role values (previously folder-role names) onto
-- the new page-access catalog before repointing the foreign key.
UPDATE dms_users SET role = CASE role
    WHEN 'Admin' THEN 'Full Access'
    WHEN 'QA' THEN 'Quality'
    WHEN 'Writer' THEN 'User'
    WHEN 'Manager' THEN 'Manager'
    WHEN 'Reader' THEN 'User'
    ELSE NULL -- any unrecognized/custom role falls back to "No Access"
END
WHERE role IS NOT NULL;

ALTER TABLE dms_users ADD CONSTRAINT dms_users_role_fkey FOREIGN KEY (role) REFERENCES dms_page_access_roles(role) ON DELETE SET NULL;
