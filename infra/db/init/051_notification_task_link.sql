-- Clicking a task-assignment notification needs somewhere to jump to — add a
-- task_id link alongside the existing document_id one (a notification is
-- about exactly one or the other, never both).
ALTER TABLE dms_notifications ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES dms_tasks(task_id) ON DELETE SET NULL;
