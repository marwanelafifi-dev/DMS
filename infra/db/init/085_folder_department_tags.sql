-- Migration 085: dms_folders gains Department and Tags, matching the same
-- fields already on dms_documents, so a folder's own metadata (edited via
-- the new "Edit" permission — see migration 084) can carry a department and
-- tags, not just Description/Classification/Owner.
-- Date: 2026-08-27

ALTER TABLE dms_folders
    ADD COLUMN IF NOT EXISTS department TEXT,
    ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
