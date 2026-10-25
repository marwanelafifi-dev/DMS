-- DMS folder/file aliases. A shortcut is only a reference: it has no MinIO
-- object key and no document-version copy. The check constraint guarantees a
-- row points at exactly one kind of original item.
CREATE TABLE IF NOT EXISTS dms_library_shortcuts (
    shortcut_id UUID PRIMARY KEY,
    parent_folder_id UUID NOT NULL REFERENCES dms_folders(folder_id) ON DELETE CASCADE,
    target_folder_id UUID NULL REFERENCES dms_folders(folder_id) ON DELETE CASCADE,
    target_document_id UUID NULL REFERENCES dms_documents(document_id) ON DELETE CASCADE,
    created_by_id UUID NOT NULL REFERENCES dms_users(user_id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_dms_library_shortcuts_one_target CHECK (
        (target_folder_id IS NOT NULL AND target_document_id IS NULL)
        OR (target_folder_id IS NULL AND target_document_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_dms_library_shortcuts_folder_target_folder
    ON dms_library_shortcuts(parent_folder_id, target_folder_id)
    WHERE target_folder_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_dms_library_shortcuts_folder_target_document
    ON dms_library_shortcuts(parent_folder_id, target_document_id)
    WHERE target_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_dms_library_shortcuts_parent_folder
    ON dms_library_shortcuts(parent_folder_id);

-- New capabilities are opt-in for all roles. Full Access is the only role
-- pre-authorized; administrators can enable either checkbox for another role
-- later from Admin Panel > Roles.
ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_create_shortcuts BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS can_share_document_links BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE dms_page_access_roles
SET can_create_shortcuts = TRUE,
    can_share_document_links = TRUE
WHERE role = 'Full Access';
