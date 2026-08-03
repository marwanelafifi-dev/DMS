-- Reverting to an older version creates a brand-new version row that reuses
-- the target version's already-uploaded S3 object (no reason to duplicate
-- unchanged bytes in MinIO) — multiple dms_document_versions rows can now
-- legitimately point at the same s3_object_key. The plain index used for
-- lookups stays; only the UNIQUE constraint from 002_core_schema.sql is dropped.
ALTER TABLE dms_document_versions DROP CONSTRAINT IF EXISTS dms_document_versions_s3_object_key_key;
