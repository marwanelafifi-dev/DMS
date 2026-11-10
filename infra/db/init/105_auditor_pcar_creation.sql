-- Auditors may raise PCAR findings, but do not receive the separate normal
-- task creation capability.
UPDATE dms_page_access_roles
SET can_create_pcars = TRUE
WHERE role = 'Auditor';
