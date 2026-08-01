-- Adds Delete as a File/Folder Permission override action, at both scopes:
-- "delete" (folder-level — delete the folder itself) and "file_delete"
-- (file-level — delete a document, cascading down from a folder override
-- the same way every other file-level action already does). Previously
-- Delete was deliberately excluded from the override system; the product
-- decision was reversed, so this brings it in line with every other action
-- instead of leaving it as the one permission an admin can't delegate or
-- restrict per user/group.
ALTER TABLE dms_access_overrides
    ADD COLUMN IF NOT EXISTS "delete" boolean,
    ADD COLUMN IF NOT EXISTS file_delete boolean;
