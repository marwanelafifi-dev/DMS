ALTER TABLE dms_tasks ADD COLUMN IF NOT EXISTS audit_stage VARCHAR(24);
ALTER TABLE dms_tasks DROP CONSTRAINT IF EXISTS dms_tasks_audit_stage_check;
ALTER TABLE dms_tasks ADD CONSTRAINT dms_tasks_audit_stage_check CHECK (audit_stage IS NULL OR audit_stage IN ('preparation', 'internal_audit', 'external_audit'));
