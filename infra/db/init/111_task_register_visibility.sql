-- Task register visibility is independent from task management. Quality,
-- Auditor, and Full Access can oversee every Task/PCAR, while ordinary users
-- remain limited to their assignments and folders they own or manage.
ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_view_all_tasks BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE dms_page_access_roles
SET can_view_all_tasks = TRUE
WHERE role IN ('Quality', 'Auditor', 'Full Access');
