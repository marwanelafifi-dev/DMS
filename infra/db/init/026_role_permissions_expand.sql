-- Migration 026: Split Upload/Update, add Approve/Reject role permissions
-- "download_for_editing" previously gated both POST (upload) and PUT (update)
-- together. Splitting them gives finer control, and also restores Writer's
-- real PUT=false default that got merged away when 025 first combined them.
-- Approve/Reject are new — they now gate the QA accept/QA request-correction
-- and Manager approve/Manager reject decisions in ApprovalsController,
-- replacing (QA-accept path) or newly adding (Manager path, which previously
-- had no role check at all) real enforcement there.
-- Date: 2026-07-30

ALTER TABLE dms_role_permissions
    ADD COLUMN IF NOT EXISTS upload BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS update_permission BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS approve BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS reject BOOLEAN NOT NULL DEFAULT false;

-- Reproduce real current per-role behavior (see RBACMiddleware/ApprovalsController)
UPDATE dms_role_permissions SET upload = false, update_permission = false, approve = false, reject = false WHERE role = 'Reader';
UPDATE dms_role_permissions SET upload = true, update_permission = false, approve = false, reject = false WHERE role = 'Writer';
UPDATE dms_role_permissions SET upload = true, update_permission = true, approve = true, reject = true WHERE role = 'QA';
UPDATE dms_role_permissions SET upload = true, update_permission = true, approve = true, reject = true WHERE role = 'Manager';
UPDATE dms_role_permissions SET upload = true, update_permission = true, approve = true, reject = true WHERE role = 'Admin';

ALTER TABLE dms_role_permissions DROP COLUMN IF EXISTS download_for_editing;
