-- Migration 037: Per-file / per-folder access overrides (File & Folder Permissions)
-- A second, narrower layer on top of the role-based system: an admin can
-- grant or deny a specific user or group one of 8 actions (read, write,
-- rename, unlock, delete, submit_for_approval, download, download_for_editing)
-- on one exact file, or on a folder (which cascades to every subfolder and
-- file inside it, unless a more specific override exists further down).
-- Enforcement rule: deny always wins — an override can only take away access
-- the role would otherwise grant, or grant access beyond the role, but any
-- applicable deny (at any level) blocks the action regardless of any allow.
-- Date: 2026-08-01

CREATE TABLE IF NOT EXISTS dms_access_overrides (
    override_id UUID PRIMARY KEY,
    folder_id UUID REFERENCES dms_folders(folder_id) ON DELETE CASCADE,
    document_id UUID REFERENCES dms_documents(document_id) ON DELETE CASCADE,
    target_type VARCHAR(10) NOT NULL CHECK (target_type IN ('User', 'Group')),
    target_id UUID NOT NULL,
    read BOOLEAN,
    write BOOLEAN,
    rename BOOLEAN,
    unlock BOOLEAN,
    delete BOOLEAN,
    submit_for_approval BOOLEAN,
    download BOOLEAN,
    download_for_editing BOOLEAN,
    created_by UUID NOT NULL REFERENCES dms_users(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_access_override_scope CHECK (
        (folder_id IS NOT NULL AND document_id IS NULL) OR
        (folder_id IS NULL AND document_id IS NOT NULL)
    ),
    UNIQUE (folder_id, document_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_access_overrides_folder ON dms_access_overrides(folder_id);
CREATE INDEX IF NOT EXISTS idx_access_overrides_document ON dms_access_overrides(document_id);
CREATE INDEX IF NOT EXISTS idx_access_overrides_target ON dms_access_overrides(target_type, target_id);
