-- Migration 086: per-folder Manager assignment and approval routing.
-- A folder can have multiple designated Managers. Only its active Owner and
-- designated Managers may act at Manager Review, and they must also have the
-- required global workflow capabilities. Submission fails when an active
-- Owner or at least one active designated Manager is missing.
-- Date: 2026-08-27

CREATE TABLE IF NOT EXISTS dms_folder_managers (
    folder_id UUID NOT NULL REFERENCES dms_folders(folder_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES dms_users(user_id) ON DELETE CASCADE,
    PRIMARY KEY (folder_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_folder_managers_user ON dms_folder_managers(user_id);
