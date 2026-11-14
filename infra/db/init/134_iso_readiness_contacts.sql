CREATE TABLE IF NOT EXISTS dms_iso_readiness_contacts (
  audit_cycle_id UUID NOT NULL REFERENCES dms_audit_cycles(audit_cycle_id) ON DELETE CASCADE,
  department_folder_id UUID NOT NULL REFERENCES dms_folders(folder_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES dms_users(user_id) ON DELETE CASCADE,
  assigned_by UUID NULL REFERENCES dms_users(user_id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (audit_cycle_id, department_folder_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_iso_readiness_contacts_folder ON dms_iso_readiness_contacts(department_folder_id);
