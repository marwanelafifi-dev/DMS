-- Migration 059: File/Folder Permission overrides gain two new file-scope
-- actions — View History (the Document Preview's version-history button) and
-- View Related Tasks (the task-history button) — as their own dedicated
-- tri-state toggles instead of silently piggybacking on Read. Per explicit
-- request: every button in Document Preview should have its own row in the
-- File Level Permissions editor.
-- Date: 2026-08-03

ALTER TABLE dms_access_overrides
    ADD COLUMN IF NOT EXISTS view_history BOOLEAN,
    ADD COLUMN IF NOT EXISTS view_related_tasks BOOLEAN;
