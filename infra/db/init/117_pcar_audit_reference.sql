-- Links a PCAR to its exact audit programme without changing historical rows.
ALTER TABLE dms_tasks ADD COLUMN IF NOT EXISTS audit_reference VARCHAR(160);
ALTER TABLE dms_tasks ADD COLUMN IF NOT EXISTS audit_date DATE;
CREATE INDEX IF NOT EXISTS ix_dms_tasks_audit_reference ON dms_tasks(audit_reference) WHERE audit_reference IS NOT NULL;
