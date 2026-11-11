ALTER TABLE dms_tasks ADD COLUMN IF NOT EXISTS finding_number VARCHAR(32);
ALTER TABLE dms_tasks ADD COLUMN IF NOT EXISTS finding_severity VARCHAR(16);
ALTER TABLE dms_tasks ADD COLUMN IF NOT EXISTS standard_clause VARCHAR(255);
ALTER TABLE dms_tasks ADD COLUMN IF NOT EXISTS auditor_notes TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_finding_number ON dms_tasks(finding_number) WHERE finding_number IS NOT NULL;
ALTER TABLE dms_tasks DROP CONSTRAINT IF EXISTS dms_tasks_finding_severity_check;
ALTER TABLE dms_tasks ADD CONSTRAINT dms_tasks_finding_severity_check CHECK (finding_severity IS NULL OR finding_severity IN ('observation', 'minor_ncr', 'major_ncr'));
