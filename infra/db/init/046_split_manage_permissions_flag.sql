-- Split the single "Manage File and Folder Permissions" role flag into two
-- independent ones — can_manage_file_permissions already existed (file
-- scope); this adds the missing folder-scope counterpart so an admin can
-- grant one without the other, matching the Access Override system's own
-- Read/FileRead-style folder/file split.
ALTER TABLE dms_page_access_roles ADD COLUMN IF NOT EXISTS can_manage_folder_permissions BOOLEAN NOT NULL DEFAULT false;
