CREATE TABLE IF NOT EXISTS dms_audit_checklist_items (
  audit_checklist_item_id UUID PRIMARY KEY,
  audit_record_id UUID NOT NULL REFERENCES dms_audit_records(audit_record_id) ON DELETE CASCADE,
  process VARCHAR(240) NOT NULL, clause VARCHAR(80) NOT NULL, requirement TEXT NOT NULL,
  result VARCHAR(32) NOT NULL DEFAULT 'not_assessed' CHECK (result IN ('not_assessed','conformity','observation','minor_ncr','major_ncr')),
  objective_evidence TEXT NULL, auditor_notes TEXT NULL, pcar_task_id UUID NULL REFERENCES dms_tasks(task_id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES dms_users(user_id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_audit_checklist_record ON dms_audit_checklist_items(audit_record_id);
