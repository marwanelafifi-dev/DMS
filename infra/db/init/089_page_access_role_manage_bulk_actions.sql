-- Migration 089: make access to multi-document operations an independently
-- managed global role capability. Existing Full Access-style roles receive
-- it initially; administrators can subsequently grant or revoke it per role.

ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_manage_bulk_actions BOOLEAN NOT NULL DEFAULT false;

UPDATE dms_page_access_roles
SET can_manage_bulk_actions = true
WHERE bypass_folder_permissions = true;
