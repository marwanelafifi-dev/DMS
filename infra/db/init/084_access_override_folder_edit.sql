-- Migration 084: File/Folder Permission overrides gain a dedicated
-- "Edit" action for the folder ITSELF (its Description/Classification
-- metadata), distinct from the existing "Edit" (file_edit) which governs a
-- document's own metadata (Description/Tags/Owner/Department/etc.). Per
-- explicit clarification: Folder Level "Edit" = edit the folder's own
-- metadata; File Level "Edit" = edit a document's metadata; "Write" already
-- covers uploading into a folder and is unrelated to either.
-- Date: 2026-08-27

ALTER TABLE dms_access_overrides
    ADD COLUMN IF NOT EXISTS folder_edit BOOLEAN;
