ALTER TABLE dms_audit_records ADD COLUMN IF NOT EXISTS participant_user_ids UUID[] NOT NULL DEFAULT '{}';
