CREATE TABLE IF NOT EXISTS dms_audit_cycle_coverage_folders (
  audit_cycle_id UUID NOT NULL REFERENCES dms_audit_cycles(audit_cycle_id) ON DELETE CASCADE,
  folder_id UUID NOT NULL REFERENCES dms_folders(folder_id) ON DELETE CASCADE,
  added_by UUID NULL REFERENCES dms_users(user_id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (audit_cycle_id, folder_id)
);
CREATE INDEX IF NOT EXISTS ix_audit_cycle_coverage_folder ON dms_audit_cycle_coverage_folders(folder_id);

-- Preserve existing cycle coverage when upgrading an established database.
INSERT INTO dms_audit_cycle_coverage_folders (audit_cycle_id, folder_id, added_by, added_at)
SELECT DISTINCT ON (r.audit_cycle_id, d.folder_id)
  r.audit_cycle_id, d.folder_id, r.created_by, r.created_at
FROM dms_evidence_requirements r
JOIN dms_documents d ON d.document_id = r.related_document_id
ORDER BY r.audit_cycle_id, d.folder_id, r.created_at
ON CONFLICT (audit_cycle_id, folder_id) DO NOTHING;
