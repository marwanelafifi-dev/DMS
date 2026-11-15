-- Readiness uses DMS Group membership by default. This explicit capability is
-- reserved for roles that oversee every department, without granting them
-- general Document Library access.
ALTER TABLE dms_page_access_roles
  ADD COLUMN IF NOT EXISTS can_view_all_iso_readiness BOOLEAN;

UPDATE dms_page_access_roles
SET can_view_all_iso_readiness = TRUE
WHERE can_view_all_iso_readiness IS NULL
  AND (bypass_folder_permissions = TRUE OR role IN ('Quality', 'Auditor'));

UPDATE dms_page_access_roles
SET can_view_all_iso_readiness = FALSE
WHERE can_view_all_iso_readiness IS NULL;

ALTER TABLE dms_page_access_roles
  ALTER COLUMN can_view_all_iso_readiness SET DEFAULT FALSE,
  ALTER COLUMN can_view_all_iso_readiness SET NOT NULL;
