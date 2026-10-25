ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_view_all_historical_pcars BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS can_import_historical_pcars BOOLEAN NOT NULL DEFAULT FALSE;

-- Full Access is the sole pre-authorized role. Every other existing and
-- future role remains unchecked until an administrator explicitly enables it.
UPDATE dms_page_access_roles
SET can_view_all_historical_pcars = TRUE,
    can_import_historical_pcars = TRUE
WHERE role = 'Full Access';
