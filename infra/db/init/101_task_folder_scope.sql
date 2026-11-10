-- Normal tasks can point at a folder or have no DMS target at all. PCARs are
-- still enforced by the API to use a released document, never a folder.
ALTER TABLE dms_tasks
    ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES dms_folders(folder_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_folder_id ON dms_tasks(folder_id);
