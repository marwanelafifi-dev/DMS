-- A general Task with no linked file/folder can nominate an active Manager
-- as its direct escalation contact. ManagerId remains the task creator.
ALTER TABLE dms_tasks
    ADD COLUMN IF NOT EXISTS direct_manager_id UUID NULL REFERENCES dms_users(user_id) ON DELETE SET NULL;

-- Existing saved policies predate the DirectManager recipient field. Preserve
-- the agreed defaults for the three escalation stages when a policy exists.
UPDATE dms_app_settings
SET value = jsonb_set(
    jsonb_set(
        jsonb_set(value::jsonb, '{secondBeforeDue,recipients,directManager}', 'true'::jsonb, true),
        '{dueDate,recipients,directManager}', 'true'::jsonb, true),
    '{overdue,recipients,directManager}', 'true'::jsonb, true)::text,
    updated_at = now()
WHERE key = 'task_notification_policy'
  AND value IS NOT NULL
  AND value <> '';
