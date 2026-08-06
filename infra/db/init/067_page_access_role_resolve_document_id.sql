-- Migration 067: Independent "Resolve Document ID" permission flag
-- Manually entering or system-generating a document's Original Document ID
-- at QA Triage was previously gated on the combination of CanApprove +
-- CanViewQaStage (itself a stale leftover of an even older per-folder QA/Admin
-- check) — too coarse and impossible to grant on its own. Splits it into its
-- own independently assignable flag, same pattern as CanCreateTasks/
-- CanReassignTasks. Seeded to match the two roles that could already do this
-- under the old combined check (Full Access, Quality), so nobody's access
-- silently regresses.

ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_resolve_document_id BOOLEAN NOT NULL DEFAULT false;

UPDATE dms_page_access_roles SET can_resolve_document_id = true WHERE role IN ('Full Access', 'Quality');
