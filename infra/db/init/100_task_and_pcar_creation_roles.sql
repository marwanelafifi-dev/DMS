-- General tasks may be raised by operational managers and Quality. PCAR
-- creation itself is still enforced in TasksController for Quality/Full Access
-- only, and requires the linked document to be released.
UPDATE dms_page_access_roles
SET can_create_tasks = TRUE
WHERE role IN ('Manager', 'Quality', 'Full Access');
