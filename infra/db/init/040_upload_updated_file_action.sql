-- Migration 040: Split "Upload Updated File" from generic Write
-- File Level Permissions now distinguishes uploading a brand-new document
-- (Write) from replacing an existing file's content (Upload Updated File —
-- the action behind the "Download for Editing" -> "Upload Updated File to
-- Unlock" flow). Gates POST /api/documents/{id}/upload specifically.
-- Date: 2026-08-01

ALTER TABLE dms_access_overrides
    ADD COLUMN IF NOT EXISTS upload_updated_file BOOLEAN;
