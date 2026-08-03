-- Migration 060: allow a task/PCAR to be assigned to a Group instead of a
-- single User — one shared task visible to every member, completable by
-- whoever gets to it first. assigned_to_id becomes nullable since a task now
-- has exactly one of assigned_to_id / assigned_to_group_id set, never both.
-- Date: 2026-08-03

ALTER TABLE dms_tasks
    ALTER COLUMN assigned_to_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS assigned_to_group_id UUID REFERENCES dms_groups(group_id) ON DELETE SET NULL;

ALTER TABLE dms_tasks DROP CONSTRAINT IF EXISTS dms_tasks_assignee_check;
ALTER TABLE dms_tasks ADD CONSTRAINT dms_tasks_assignee_check CHECK (
    (assigned_to_id IS NOT NULL AND assigned_to_group_id IS NULL) OR
    (assigned_to_id IS NULL AND assigned_to_group_id IS NOT NULL)
);
