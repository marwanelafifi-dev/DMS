-- Migration 070: Track when an approval document actually entered its
-- current stage/status, not just when the batch was originally created.
-- dms_approval_documents.created_at is a one-time timestamp set when the row
-- is first inserted (at initial batch submission) and nothing ever updates
-- it afterward — but the Document Workflow queue's "Submitted" column reads
-- that same field, so a resubmitted correction (which re-uses the existing
-- approval_document row, just re-pointing its version and flipping status
-- back to "pending") kept showing the original submission date from days
-- earlier instead of when it actually re-entered the reviewer's queue.

ALTER TABLE dms_approval_documents
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill existing rows to their original creation time rather than the
-- migration's own run time, since nothing has actually changed for them yet.
UPDATE dms_approval_documents SET updated_at = created_at;
