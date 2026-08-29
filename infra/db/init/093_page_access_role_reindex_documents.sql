-- Dedicated global-role capability for rebuilding document OCR/search data.
-- Existing roles remain denied by default; Full Access keeps administrative
-- continuity and can delegate the capability from Admin Panel > Roles.

ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_reindex_documents BOOLEAN NOT NULL DEFAULT false;

UPDATE dms_page_access_roles
SET can_reindex_documents = true
WHERE bypass_folder_permissions = true;
