-- Migration 072: real bug found live — the Document Library's "Submit for
-- Approval" modal already had an "Approval Notes (Optional)" textarea and
-- already sent it to the API as approvalNotes, but SubmitApprovalRequest on
-- the backend never had a matching field at all — the note was silently
-- dropped on every submission, with no error, so it looked "saved" from the
-- submitter's side but never existed anywhere QA/Manager could see it.

ALTER TABLE dms_approval_documents
    ADD COLUMN IF NOT EXISTS submission_note TEXT;
