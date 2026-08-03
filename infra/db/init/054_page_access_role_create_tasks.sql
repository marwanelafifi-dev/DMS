-- Migration 054: Independent "Create New PCAR" permission flag
-- "Manage All Tasks / PCARs" (migration 053) governs editing/completing/
-- deleting ANY task, but the "New PCAR" button (create a task and assign it
-- to anyone) was tied to that same flag — too coarse. Splits it into its own
-- independently assignable flag, same pattern as the Edit/ManagePermissions
-- split for documents.

ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_create_tasks BOOLEAN NOT NULL DEFAULT false;

UPDATE dms_page_access_roles SET can_create_tasks = true WHERE role = 'Full Access';
