-- Migration 021: Persist Document Category
-- The "Document Category" chosen on upload (Policy/Process/Standard/etc.) was
-- only ever held in frontend form state and discarded after Save as Draft —
-- nothing persisted it, so submitting that draft for approval later had no
-- record of the category and had to ask again.
-- Date: 2026-07-30

ALTER TABLE dms_documents
ADD COLUMN IF NOT EXISTS category VARCHAR(100);
