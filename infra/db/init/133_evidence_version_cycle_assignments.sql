-- Evidence is an operational record. Keep the exact immutable version that
-- was used for each audit cycle, rather than overwriting its cycle assignment
-- whenever the same evidence record is updated for a later cycle.
CREATE TABLE IF NOT EXISTS dms_evidence_version_cycle_assignments (
  document_id UUID NOT NULL REFERENCES dms_documents(document_id) ON DELETE CASCADE,
  audit_cycle_id UUID NOT NULL REFERENCES dms_audit_cycles(audit_cycle_id) ON DELETE RESTRICT,
  version_id UUID NOT NULL REFERENCES dms_document_versions(version_id) ON DELETE RESTRICT,
  standard VARCHAR(32) NOT NULL CHECK (standard IN ('ISO 9001:2015','ISO 27001:2022')),
  assigned_by UUID NOT NULL REFERENCES dms_users(user_id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, audit_cycle_id)
);

CREATE INDEX IF NOT EXISTS ix_evidence_version_cycle_assignments_cycle
  ON dms_evidence_version_cycle_assignments(audit_cycle_id, version_id);

-- Preserve the cycle assignment already recorded by the earlier feature.
-- The current immutable version is the evidence version that was visible when
-- that assignment was made.
INSERT INTO dms_evidence_version_cycle_assignments (
  document_id, audit_cycle_id, version_id, standard, assigned_by, assigned_at
)
SELECT
  assignment.document_id,
  assignment.audit_cycle_id,
  document.current_version_id,
  assignment.standard,
  assignment.assigned_by,
  assignment.assigned_at
FROM dms_evidence_cycle_assignments assignment
JOIN dms_documents document ON document.document_id = assignment.document_id
WHERE document.current_version_id IS NOT NULL
ON CONFLICT (document_id, audit_cycle_id) DO NOTHING;
