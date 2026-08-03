-- Migration 053: Blanket "Manage All Tasks" permission flag
-- PCAR/Corrective Action tasks had no distinction between "this is my own
-- assigned task, let me work on it" and "I can edit/complete/manage anyone's
-- task" — every authenticated user saw the Edit/Complete/Delete action icons
-- on every row returned by GetMyTasksAsync (which already includes tasks the
-- user only created/delegated as manager, not just ones assigned to them).
-- Adds an explicit, independently assignable flag; only "Full Access" gets it
-- by default, matching the "only Admin should be able to do this" requirement.

ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_manage_all_tasks BOOLEAN NOT NULL DEFAULT false;

UPDATE dms_page_access_roles SET can_manage_all_tasks = true WHERE role = 'Full Access';
