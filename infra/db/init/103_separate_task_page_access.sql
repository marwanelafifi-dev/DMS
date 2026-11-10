-- Independent visibility for the Internal Tasks register. Existing normal
-- operational roles retain task access; PCAR visibility remains controlled by
-- the existing can_view_pcar capability.
ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_view_tasks BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_create_pcars BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE dms_page_access_roles
SET can_view_tasks = TRUE
WHERE role IN ('User', 'Manager', 'Quality', 'Auditor', 'Full Access');

UPDATE dms_page_access_roles
SET can_create_pcars = TRUE
WHERE role IN ('Quality', 'Full Access');
