-- Deletion is more sensitive than resource-scoped task management. Quality
-- and Full Access may remove an open Task or PCAR; folder owners/managers may
-- never delete records solely because they manage the linked folder.
ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_delete_tasks BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE dms_page_access_roles
SET can_delete_tasks = TRUE
WHERE role IN ('Quality', 'Full Access');
