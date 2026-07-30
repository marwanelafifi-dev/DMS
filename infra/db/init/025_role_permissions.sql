-- Migration 025: Editable, Enforced Role Permissions
-- Moves folder/document access control off the hardcoded switch in
-- RBACMiddleware.HasPermissionForMethod into this table, so editing a
-- role's permissions on the Roles admin page actually changes what that
-- role can do — not just what's displayed.
--
-- Seed values reproduce the ACTUAL current enforcement (GET/POST/PUT/DELETE
-- per role), not the old cosmetic Permissions Matrix table (which had drifted:
-- QA could already PUT and Manager could already DELETE despite the old
-- table showing otherwise). POST and PUT are merged under "download_for_editing"
-- since the UI only exposes 4 permission tags, not one per HTTP method — the
-- one behavior change from today is Writer gaining PUT (it already had POST).
-- Date: 2026-07-30

CREATE TABLE IF NOT EXISTS dms_role_permissions (
    role VARCHAR(50) PRIMARY KEY,
    view_only BOOLEAN NOT NULL DEFAULT false,
    download_read_only BOOLEAN NOT NULL DEFAULT false,
    download_for_editing BOOLEAN NOT NULL DEFAULT false,
    admin_force_unlock BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO dms_role_permissions (role, view_only, download_read_only, download_for_editing, admin_force_unlock)
VALUES
    ('Reader', true, true, false, false),
    ('Writer', true, true, true, false),
    ('QA', true, true, true, false),
    ('Manager', true, true, true, true),
    ('Admin', true, true, true, true)
ON CONFLICT (role) DO NOTHING;
