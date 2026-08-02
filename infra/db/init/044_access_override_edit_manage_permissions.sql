-- Two new independently-grantable actions, following the same pattern as the
-- Delete action added in migration 042:
--   file_edit             — editing a document's metadata (description, tags,
--                            version, category, department, owner), separate
--                            from Rename (which only changes the file name).
--   manage_permissions / file_manage_permissions — who can open the Folder
--                            Permissions / File Permissions modal itself, split
--                            into folder- and file-scope like Read/FileRead.
--                            Previously hardcoded to require AdminForceUnlock.
ALTER TABLE dms_access_overrides ADD COLUMN IF NOT EXISTS file_edit BOOLEAN;
ALTER TABLE dms_access_overrides ADD COLUMN IF NOT EXISTS manage_permissions BOOLEAN;
ALTER TABLE dms_access_overrides ADD COLUMN IF NOT EXISTS file_manage_permissions BOOLEAN;
