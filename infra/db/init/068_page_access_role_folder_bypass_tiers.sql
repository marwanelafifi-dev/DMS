-- Migration 068: Tiered folder-bypass flags — "Read Folders Only" and "Read
-- and Write Folders Only"
-- BypassFolderPermissions ("Full Access to All Folders") already lets a role
-- act as Admin on every folder with no per-folder grant needed — these two
-- new flags are weaker versions of the same idea: automatic visibility (and,
-- for the write variant, upload/edit rights) on every folder, without needing
-- an explicit per-folder Reader/Writer grant, but capped well short of Admin
-- (no delete, no permission management). A per-folder grant or an explicit
-- Deny override still takes precedence, same as BypassFolderPermissions.

ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_read_all_folders BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS can_read_write_all_folders BOOLEAN NOT NULL DEFAULT false;
