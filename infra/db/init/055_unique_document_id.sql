-- Migration 055: Enforce Document ID uniqueness
-- OriginalDocumentId ("Doc ID") had no uniqueness check anywhere — manual
-- entry, auto-extraction from file content, and system-generation could all
-- independently produce a value already used by another document. Adds a
-- case-insensitive unique index (partial: documents with no ID yet are
-- unaffected) as a hard DB-level safety net, on top of the friendly
-- application-level checks added in DocumentsController.

CREATE UNIQUE INDEX IF NOT EXISTS ux_dms_documents_original_document_id
    ON dms_documents (LOWER(original_document_id))
    WHERE original_document_id IS NOT NULL;
