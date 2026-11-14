ALTER TABLE dms_audit_calendar_events ADD COLUMN IF NOT EXISTS programme_year INTEGER;
ALTER TABLE dms_audit_calendar_events ADD COLUMN IF NOT EXISTS stage_key VARCHAR(48);
ALTER TABLE dms_audit_calendar_events ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'planned';
ALTER TABLE dms_audit_calendar_events ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES dms_users(user_id) ON DELETE SET NULL;
ALTER TABLE dms_audit_calendar_events ADD COLUMN IF NOT EXISTS due_date DATE;
CREATE INDEX IF NOT EXISTS ix_audit_calendar_programme_year ON dms_audit_calendar_events(programme_year, event_date);
