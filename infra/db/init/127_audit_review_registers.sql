ALTER TABLE dms_audit_records ADD COLUMN IF NOT EXISTS audit_plan_document_id UUID NULL REFERENCES dms_documents(document_id) ON DELETE SET NULL;
ALTER TABLE dms_audit_records ADD COLUMN IF NOT EXISTS audit_report_document_id UUID NULL REFERENCES dms_documents(document_id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS dms_evidence_requirements (
  evidence_requirement_id UUID PRIMARY KEY,
  audit_cycle_id UUID NOT NULL REFERENCES dms_audit_cycles(audit_cycle_id) ON DELETE CASCADE,
  related_document_id UUID NOT NULL REFERENCES dms_documents(document_id) ON DELETE CASCADE,
  standard VARCHAR(32) NOT NULL CHECK (standard IN ('ISO 9001:2015','ISO 27001:2022')),
  created_by UUID NOT NULL REFERENCES dms_users(user_id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(audit_cycle_id, related_document_id)
);
CREATE TABLE IF NOT EXISTS dms_management_review_entries (
  management_review_entry_id UUID PRIMARY KEY, audit_cycle_id UUID NOT NULL REFERENCES dms_audit_cycles(audit_cycle_id) ON DELETE CASCADE,
  standard VARCHAR(32) NOT NULL CHECK (standard IN ('ISO 9001:2015','ISO 27001:2022')),
  category VARCHAR(32) NOT NULL CHECK (category IN ('kpi','risk','customer_feedback','supplier_performance','action')),
  title VARCHAR(240) NOT NULL, detail TEXT NULL, status VARCHAR(24) NOT NULL DEFAULT 'open', owner_id UUID NULL REFERENCES dms_users(user_id) ON DELETE SET NULL,
  due_date DATE NULL, source_document_id UUID NULL REFERENCES dms_documents(document_id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES dms_users(user_id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_management_review_cycle ON dms_management_review_entries(audit_cycle_id, category);
