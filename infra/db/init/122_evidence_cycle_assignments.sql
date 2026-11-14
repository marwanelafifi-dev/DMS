CREATE TABLE IF NOT EXISTS dms_evidence_cycle_assignments (
  document_id UUID PRIMARY KEY REFERENCES dms_documents(document_id) ON DELETE CASCADE,
  audit_cycle_id UUID NOT NULL REFERENCES dms_audit_cycles(audit_cycle_id) ON DELETE RESTRICT,
  standard VARCHAR(32) NOT NULL CHECK (standard IN ('ISO 9001:2015','ISO 27001:2022')),
  assigned_by UUID NOT NULL REFERENCES dms_users(user_id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_evidence_cycle_assignments_cycle ON dms_evidence_cycle_assignments(audit_cycle_id);
