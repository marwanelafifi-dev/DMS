-- Migration 056: per-role visibility into the three C-Doc Workflow (Approvals)
-- stages. CanViewApprovals alone used to be all-or-nothing for the whole page;
-- this splits it so a role can be scoped to only the stage(s) it actually acts
-- on — e.g. Manager only ever needed Stage 2, Quality only Stage 1 and Stage 3.
-- Date: 2026-08-03

ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_view_qa_stage BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS can_view_manager_stage BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS can_view_final_release_stage BOOLEAN NOT NULL DEFAULT true;

-- Quality previously had CanViewApprovals = false entirely (QA work was assumed
-- to happen elsewhere) — turn it on now that Quality is explicitly scoped to
-- the QA Review and Final Release stages.
UPDATE dms_page_access_roles SET can_view_approvals = true WHERE role = 'Quality';

UPDATE dms_page_access_roles SET
    can_view_qa_stage = false,
    can_view_manager_stage = true,
    can_view_final_release_stage = false
WHERE role = 'Manager';

UPDATE dms_page_access_roles SET
    can_view_qa_stage = true,
    can_view_manager_stage = false,
    can_view_final_release_stage = true
WHERE role = 'Quality';

UPDATE dms_page_access_roles SET
    can_view_qa_stage = true,
    can_view_manager_stage = true,
    can_view_final_release_stage = true
WHERE role = 'Full Access';
