-- Migration 137: split ISO 9001 Readiness from the Audit Plan & Register.
-- Existing workspace access retains the Audit Plan permission until an
-- administrator explicitly removes it from the role in Admin -> Roles.
ALTER TABLE dms_page_access_roles
  ADD COLUMN IF NOT EXISTS can_view_iso9001_audit_plan BOOLEAN;

UPDATE dms_page_access_roles
SET can_view_iso9001_audit_plan = can_view_iso9001_workspace
WHERE can_view_iso9001_audit_plan IS NULL;

ALTER TABLE dms_page_access_roles
  ALTER COLUMN can_view_iso9001_audit_plan SET DEFAULT false,
  ALTER COLUMN can_view_iso9001_audit_plan SET NOT NULL;
