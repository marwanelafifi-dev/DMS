-- Migration 071: split "Reassign Tasks / PCARs" into two independent flags,
-- per explicit request:
--   - can_reassign_my_tasks: reassign only tasks the caller already owns
--     (assignee or manager) to someone else — no visibility/action on other
--     people's tasks at all.
--   - can_reassign_tasks (066, unchanged): reassign ANY task, own or not.
-- CanManageAllTasks continues to imply both (it already grants full edit,
-- since a task owner-or-not distinction is moot once you can manage everything).

ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_reassign_my_tasks BOOLEAN NOT NULL DEFAULT false;

UPDATE dms_page_access_roles SET can_reassign_my_tasks = true WHERE role = 'Full Access';
