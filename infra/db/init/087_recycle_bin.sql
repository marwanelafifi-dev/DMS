-- Recoverable deletion for Document Library files and folder trees.
ALTER TABLE dms_folders
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by_id UUID REFERENCES dms_users(user_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS deletion_batch_id UUID;

ALTER TABLE dms_documents
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by_id UUID REFERENCES dms_users(user_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS deletion_batch_id UUID;

DROP INDEX IF EXISTS ix_dms_folders_parent_folder_id_name;
DROP INDEX IF EXISTS "IX_dms_folders_parent_folder_id_name";
CREATE UNIQUE INDEX IF NOT EXISTS ux_dms_folders_active_parent_name
    ON dms_folders(parent_folder_id, name) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_dms_folders_deleted_at ON dms_folders(deleted_at);
CREATE INDEX IF NOT EXISTS ix_dms_documents_deleted_at ON dms_documents(deleted_at);
CREATE INDEX IF NOT EXISTS ix_dms_folders_deletion_batch ON dms_folders(deletion_batch_id);
CREATE INDEX IF NOT EXISTS ix_dms_documents_deletion_batch ON dms_documents(deletion_batch_id);
