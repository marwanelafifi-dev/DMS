-- Migration 035: Split "Update" into Update File and Update Folder
-- 034 temporarily gated PUT (both documents and folders) behind Upload. Per
-- explicit follow-up, editing an existing file's metadata and editing an
-- existing folder's metadata are now two separate, independently assignable
-- flags — Upload goes back to meaning only "create something new" (POST).
-- Date: 2026-08-01

ALTER TABLE dms_role_permissions
    ADD COLUMN IF NOT EXISTS update_file BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS update_folder BOOLEAN NOT NULL DEFAULT false;

-- Backfill from the current Upload value so no existing role loses capability.
UPDATE dms_role_permissions SET update_file = upload, update_folder = upload;
