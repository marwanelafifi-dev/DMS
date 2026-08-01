-- Migration 041: Split Read/Rename/Copy/Cut into folder-scope vs file-scope
-- These 4 actions appear in BOTH the Folder Level and File Level sections of
-- the permissions modal, but governing "can you read/rename/copy/cut the
-- FOLDER itself" is a genuinely different thing from "...the FILES inside
-- it" — sharing one column meant the two toggles weren't actually
-- independent. Existing read/rename/copy/cut columns now mean folder-scope
-- specifically; new file_* columns cover the file-scope meaning. Write is
-- deliberately NOT split — Folder Level "Write" and File Level "Upload" are
-- the same real capability by explicit design choice.
-- Date: 2026-08-01

ALTER TABLE dms_access_overrides
    ADD COLUMN IF NOT EXISTS file_read BOOLEAN,
    ADD COLUMN IF NOT EXISTS file_rename BOOLEAN,
    ADD COLUMN IF NOT EXISTS file_copy BOOLEAN,
    ADD COLUMN IF NOT EXISTS file_cut BOOLEAN;
