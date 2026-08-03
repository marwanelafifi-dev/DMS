-- Migration 058: track C-Doc Workflow stage/status per DOCUMENT instead of per
-- approval BATCH. Found via direct user testing: accepting one document out of
-- a 7-document upload batch silently accepted all 7, since CurrentStage/Status
-- lived only on dms_approvals (shared by the whole batch). From this migration
-- forward, each dms_approval_documents row carries its own stage/status/notes,
-- so QA/Manager/Release actions on one document never move the others.
-- Date: 2026-08-03

ALTER TABLE dms_approval_documents
    ADD COLUMN IF NOT EXISTS current_stage VARCHAR(50) NOT NULL DEFAULT 'qa_review',
    ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS qa_notes TEXT,
    ADD COLUMN IF NOT EXISTS manager_notes TEXT,
    ADD COLUMN IF NOT EXISTS release_notes TEXT;

-- Backfill existing rows from their parent approval's current progress so
-- nothing already in flight appears reset to Stage 1.
UPDATE dms_approval_documents ad
SET current_stage = a.current_stage,
    status = a.status,
    qa_notes = a.qa_notes,
    manager_notes = a.manager_notes,
    release_notes = a.release_notes
FROM dms_approvals a
WHERE ad.approval_id = a.approval_id;
