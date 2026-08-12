-- Migration 073: real gap found live — RemindersController.DeleteReminder had
-- no permission check of any kind, so any user who could see the Reminders
-- page at all could delete ANY reminder, not just their own. Per explicit
-- request, gate this behind a new, independently-grantable role-wide flag,
-- same pattern as the other blanket flags (CanManageAllTasks, etc.).

ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_delete_reminders BOOLEAN NOT NULL DEFAULT false;

UPDATE dms_page_access_roles SET can_delete_reminders = true WHERE role = 'Full Access';
