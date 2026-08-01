-- Migration 034: Restore Upload as its own separate flag
-- 033 incorrectly folded Upload into the new "Download (for Editing)" flag.
-- Upload (adding new files, and editing/replacing existing ones) is its own
-- permission; Download (for Editing) is specifically about downloading the
-- real/original file rather than a read-only copy.
-- Date: 2026-08-01

ALTER TABLE dms_role_permissions
    ADD COLUMN IF NOT EXISTS upload BOOLEAN NOT NULL DEFAULT false;

-- 033 set download_for_editing = (old upload OR old update) for every role —
-- that's exactly the right starting value for the restored Upload flag too.
UPDATE dms_role_permissions SET upload = download_for_editing;
