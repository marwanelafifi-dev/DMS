-- Separate access to the Historical PCAR Archive from the live PCAR page.
-- Existing roles that were already allowed to view all/import the archive
-- retain access; all other roles need an administrator to opt them in.
ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_view_historical_pcars BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE dms_page_access_roles
SET can_view_historical_pcars = TRUE
WHERE can_view_all_historical_pcars = TRUE
   OR can_import_historical_pcars = TRUE;
