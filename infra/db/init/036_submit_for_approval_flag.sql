-- Migration 036: Add a real "Submit for Approval" permission flag
-- POST /api/approvals/submit-batch (and POST /api/documents/{id}/submit) had
-- no role/permission check at all beyond "you own the document" — any
-- authenticated user, including Reader, could submit a document into the
-- C-Doc approval workflow. Adds an explicit, independently assignable flag.
-- Date: 2026-08-01

ALTER TABLE dms_role_permissions
    ADD COLUMN IF NOT EXISTS submit_for_approval BOOLEAN NOT NULL DEFAULT false;

-- Backfill: every role that could already upload/edit a document could also
-- submit it, matching current real-world usage (submission has always been
-- open to anyone who owns the document, which in practice means an uploader).
UPDATE dms_role_permissions SET submit_for_approval = upload;
