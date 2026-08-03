-- Migration 057: move Approve/Reject on the C-Doc Workflow onto the page-access
-- role, decoupled from per-folder role grants entirely. Per explicit request:
-- Folder/File Permission overrides and per-folder role grants govern file/folder
-- MANAGEMENT actions only (upload/rename/copy/cut/delete/etc.) — approving or
-- rejecting an approval batch should be controlled purely from the Roles page,
-- the same place CanView*Stage already lives, not from a folder grant.
-- Date: 2026-08-03

ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_approve BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS can_reject BOOLEAN NOT NULL DEFAULT false;

UPDATE dms_page_access_roles SET can_approve = true, can_reject = true
WHERE role IN ('Manager', 'Quality', 'Full Access');
