-- Migration 065: "Send Announcements" becomes a real, role-editable flag
-- instead of a hardcoded "Full Access or Quality" name check — same pattern
-- as CanApprove/CanCreateTasks. Defaults to on for the two roles that
-- originally had it hardcoded; any role's checkbox can be toggled from the
-- Roles admin page from here on.
ALTER TABLE dms_page_access_roles ADD COLUMN IF NOT EXISTS can_send_announcements BOOLEAN NOT NULL DEFAULT false;

UPDATE dms_page_access_roles
SET can_send_announcements = true
WHERE role IN ('Full Access', 'Quality');
