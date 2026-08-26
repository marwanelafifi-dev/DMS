-- Migration 083: File/Folder Permission overrides gain a third dedicated
-- Document Preview action — View Metadata History (the "Metadata History"
-- button showing a document's imported KnowledgeTree legacy metadata
-- snapshots) — as its own tri-state toggle, matching the existing
-- View History / View Related Tasks pattern from migration 059. Per explicit
-- request: every button in Document Preview should have its own row in the
-- File Level Permissions editor.
-- Date: 2026-08-25

ALTER TABLE dms_access_overrides
    ADD COLUMN IF NOT EXISTS view_metadata_history BOOLEAN;
