-- Migration 074: real gap found live — clicking an announcement's notification
-- did nothing useful (fell through to the generic "/tasks" fallback), since
-- NotifyAsync never recorded which announcement a notification was actually
-- about. Adds the missing link so a click can open that specific announcement
-- on the Dashboard.

ALTER TABLE dms_notifications
    ADD COLUMN IF NOT EXISTS announcement_id UUID REFERENCES dms_announcements(announcement_id) ON DELETE CASCADE;
