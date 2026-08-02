-- Two blanket, role-wide flags — "every user assigned this role can Edit /
-- manage File and Folder Permissions everywhere", the same coarse-grained
-- pattern as the existing bypass_folder_permissions flag, rather than having
-- to grant it folder-by-folder through an Access Override.
ALTER TABLE dms_page_access_roles ADD COLUMN IF NOT EXISTS can_edit_files BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE dms_page_access_roles ADD COLUMN IF NOT EXISTS can_manage_file_permissions BOOLEAN NOT NULL DEFAULT false;
