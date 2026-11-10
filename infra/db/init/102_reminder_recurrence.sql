ALTER TABLE dms_reminders ADD COLUMN IF NOT EXISTS recurrence VARCHAR(16) NOT NULL DEFAULT 'once';
ALTER TABLE dms_reminders DROP CONSTRAINT IF EXISTS dms_reminders_recurrence_check;
ALTER TABLE dms_reminders ADD CONSTRAINT dms_reminders_recurrence_check CHECK (recurrence IN ('once', 'weekly', 'monthly', 'quarterly', 'semiannual', 'yearly'));
