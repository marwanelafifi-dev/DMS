-- Migration 033: Role permission flags redesign
-- Replaces the 7-flag set (view_only, download_read_only, upload,
-- update_permission, approve, reject, admin_force_unlock) with a more
-- granular 12-flag set the user asked for directly: Upload and Update are
-- merged into one "Download (for Editing)" flag (the pre-026 "download for
-- editing" concept, reinstated under a clearer name), and folder/task
-- create+delete become their own explicit flags instead of being implied by
-- a generic Writer-role check.
-- Date: 2026-08-01

ALTER TABLE dms_role_permissions
    ADD COLUMN IF NOT EXISTS download_for_editing BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS create_subfolder BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS create_parent_folder BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS add_task BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS delete_parent_folder BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS delete_subfolder BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS delete_file BOOLEAN NOT NULL DEFAULT false;

-- Fold every existing role's Upload/Update into the new combined flag first,
-- for every role including custom ones — this is a pure superset, no access lost.
UPDATE dms_role_permissions SET download_for_editing = (upload OR update_permission);

-- Backfill the new granular create/delete flags for the 5 built-in roles to
-- match their previous effective capability level (Admin/Manager could
-- already delete via admin_force_unlock; QA/Writer could not).
UPDATE dms_role_permissions SET
    create_subfolder = true, create_parent_folder = true, add_task = true,
    delete_parent_folder = true, delete_subfolder = true, delete_file = true
WHERE role IN ('Admin', 'Manager');

UPDATE dms_role_permissions SET
    create_subfolder = false, create_parent_folder = false, add_task = true,
    delete_parent_folder = false, delete_subfolder = false, delete_file = false
WHERE role IN ('QA', 'Writer');

-- Reader and any custom role keep the safe all-false defaults above.

ALTER TABLE dms_role_permissions
    DROP COLUMN IF EXISTS upload,
    DROP COLUMN IF EXISTS update_permission;
