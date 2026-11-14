ALTER TABLE dms_audit_records ADD COLUMN IF NOT EXISTS audit_team_user_ids UUID[] NOT NULL DEFAULT '{}';
