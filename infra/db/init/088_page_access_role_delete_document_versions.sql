-- Migration 088: independently managed permission for deleting historical
-- document versions. Existing Full Access-style roles receive it initially;
-- administrators can subsequently grant or revoke it on any role.

ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_delete_document_versions BOOLEAN NOT NULL DEFAULT false;

UPDATE dms_page_access_roles
SET can_delete_document_versions = true
WHERE bypass_folder_permissions = true;

-- Keep immutable compliance evidence intact when a historical version is
-- removed from the application. Normal EF queries exclude these tombstones.
ALTER TABLE dms_document_versions
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by_id UUID REFERENCES dms_users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dms_document_versions_active
    ON dms_document_versions(document_id, created_at DESC)
    WHERE deleted_at IS NULL;
