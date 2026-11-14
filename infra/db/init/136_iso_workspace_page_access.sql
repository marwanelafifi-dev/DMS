-- Migration 136: ISO workspaces are independent Role permissions.
-- Preserve existing access at upgrade time: ISO 9001 previously required the
-- PCAR page capability and ISO 27001 previously required Dashboard access.
ALTER TABLE dms_page_access_roles
  ADD COLUMN IF NOT EXISTS can_view_iso9001_workspace BOOLEAN,
  ADD COLUMN IF NOT EXISTS can_view_iso27001_workspace BOOLEAN;

UPDATE dms_page_access_roles
SET can_view_iso9001_workspace = can_view_pcar
WHERE can_view_iso9001_workspace IS NULL;

UPDATE dms_page_access_roles
SET can_view_iso27001_workspace = can_view_dashboard
WHERE can_view_iso27001_workspace IS NULL;

ALTER TABLE dms_page_access_roles
  ALTER COLUMN can_view_iso9001_workspace SET DEFAULT false,
  ALTER COLUMN can_view_iso9001_workspace SET NOT NULL,
  ALTER COLUMN can_view_iso27001_workspace SET DEFAULT false,
  ALTER COLUMN can_view_iso27001_workspace SET NOT NULL;
