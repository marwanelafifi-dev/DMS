-- Migration 061: track "built-in" status by a stable flag, not by name.
-- Renaming a role (added this session) previously left delete-protection
-- keyed off the literal role name ("Full Access" etc.) via a hardcoded
-- array in PageAccessRolesController — rename one of those 5 roles and it
-- would silently become an ordinary, deletable role. This column makes that
-- status travel with the row through a rename instead.
ALTER TABLE dms_page_access_roles ADD COLUMN IF NOT EXISTS is_built_in BOOLEAN NOT NULL DEFAULT false;

UPDATE dms_page_access_roles
SET is_built_in = true
WHERE role IN ('User', 'Manager', 'Quality', 'Auditor', 'Full Access');
