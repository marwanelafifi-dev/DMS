-- Migration 066: Independent "Reassign Tasks / PCARs" permission flag
-- Lets a role change a task's Assignee (user or group) without also needing
-- the broader "Manage All Tasks / PCARs" flag, which additionally grants
-- edit/complete/delete over every task. CanManageAllTasks continues to imply
-- this too (checked as CanManageAllTasks || CanReassignTasks everywhere), same
-- split pattern as CanCreateTasks (migration 054).

ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_reassign_tasks BOOLEAN NOT NULL DEFAULT false;

UPDATE dms_page_access_roles SET can_reassign_tasks = true WHERE role = 'Full Access';
