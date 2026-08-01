-- Migration 039: Folder-only override actions
-- Per explicit request, folder-scoped File/Folder Permission overrides show a
-- different action set than file-scoped ones: Copy, Cut, Download as ZIP, and
-- Create Subfolder replace Submit for Approval, Download for Editing,
-- Download, and Unlock (which stay file-only). The underlying table keeps
-- all columns since one row is always either folder- or document-scoped —
-- the frontend and the resolution logic simply don't use the file-only
-- columns for a folder-scoped row, or vice versa.
-- Date: 2026-08-01

ALTER TABLE dms_access_overrides
    ADD COLUMN IF NOT EXISTS copy BOOLEAN,
    ADD COLUMN IF NOT EXISTS cut BOOLEAN,
    ADD COLUMN IF NOT EXISTS download_zip BOOLEAN,
    ADD COLUMN IF NOT EXISTS create_subfolder BOOLEAN;
