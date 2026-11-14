CREATE TABLE IF NOT EXISTS dms_audit_records (
  audit_record_id UUID PRIMARY KEY,
  audit_cycle_id UUID NOT NULL REFERENCES dms_audit_cycles(audit_cycle_id) ON DELETE RESTRICT,
  standard VARCHAR(32) NOT NULL CHECK (standard IN ('ISO 9001:2015','ISO 27001:2022')),
  title VARCHAR(240) NOT NULL,
  audit_type VARCHAR(32) NOT NULL CHECK (audit_type IN ('preparation','internal','management_review','external')),
  status VARCHAR(24) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','cancelled')),
  audit_date DATE NOT NULL,
  scope TEXT NOT NULL,
  departments TEXT[] NOT NULL DEFAULT '{}',
  audit_team TEXT[] NOT NULL DEFAULT '{}',
  audit_plan_reference TEXT NULL,
  audit_report_reference TEXT NULL,
  notes TEXT NULL,
  created_by UUID NOT NULL REFERENCES dms_users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_audit_records_cycle ON dms_audit_records(audit_cycle_id, audit_date);
ALTER TABLE dms_tasks ADD COLUMN IF NOT EXISTS audit_record_id UUID REFERENCES dms_audit_records(audit_record_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_tasks_audit_record ON dms_tasks(audit_record_id);
