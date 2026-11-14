ALTER TABLE dms_audit_calendar_events ADD COLUMN IF NOT EXISTS audit_cycle_id UUID REFERENCES dms_audit_cycles(audit_cycle_id) ON DELETE SET NULL;
ALTER TABLE dms_evidence_links ADD COLUMN IF NOT EXISTS audit_cycle_id UUID REFERENCES dms_audit_cycles(audit_cycle_id) ON DELETE SET NULL;
ALTER TABLE dms_tasks ADD COLUMN IF NOT EXISTS audit_standard VARCHAR(32);
ALTER TABLE dms_tasks ADD COLUMN IF NOT EXISTS audit_cycle_id UUID REFERENCES dms_audit_cycles(audit_cycle_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_evidence_links_cycle ON dms_evidence_links(audit_cycle_id);
CREATE INDEX IF NOT EXISTS ix_tasks_audit_cycle ON dms_tasks(audit_cycle_id);
