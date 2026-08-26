-- Full KnowledgeTree migration support.
--
-- Source-document registration is deliberately independent of an active
-- New-DMS document mapping.  This lets us retain metadata/content evidence for
-- a source-file or business-owner exception without creating a fake active
-- document merely to satisfy a foreign key.

CREATE TABLE IF NOT EXISTS dms_legacy_source_documents (
    source_system       TEXT NOT NULL,
    legacy_document_id  BIGINT NOT NULL,
    first_migration_run_id UUID NOT NULL REFERENCES dms_legacy_migration_runs(run_id),
    registered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_system, legacy_document_id)
);

INSERT INTO dms_legacy_source_documents (
    source_system, legacy_document_id, first_migration_run_id, registered_at
)
SELECT source_system, legacy_document_id, migration_run_id, migrated_at
FROM dms_legacy_document_mappings
ON CONFLICT (source_system, legacy_document_id) DO NOTHING;

ALTER TABLE dms_legacy_metadata_snapshots
    DROP CONSTRAINT IF EXISTS dms_legacy_metadata_snapshots_source_system_legacy_documen_fkey;
ALTER TABLE dms_legacy_metadata_snapshots
    DROP CONSTRAINT IF EXISTS dms_legacy_metadata_snapshots_source_document_fkey;
ALTER TABLE dms_legacy_metadata_snapshots
    ADD CONSTRAINT dms_legacy_metadata_snapshots_source_document_fkey
    FOREIGN KEY (source_system, legacy_document_id)
    REFERENCES dms_legacy_source_documents(source_system, legacy_document_id)
    ON DELETE RESTRICT;

ALTER TABLE dms_legacy_content_versions
    DROP CONSTRAINT IF EXISTS dms_legacy_content_versions_source_system_legacy_document__fkey;
ALTER TABLE dms_legacy_content_versions
    DROP CONSTRAINT IF EXISTS dms_legacy_content_versions_source_document_fkey;
ALTER TABLE dms_legacy_content_versions
    ADD CONSTRAINT dms_legacy_content_versions_source_document_fkey
    FOREIGN KEY (source_system, legacy_document_id)
    REFERENCES dms_legacy_source_documents(source_system, legacy_document_id)
    ON DELETE RESTRICT;

-- File-system dates are physical-export evidence, not legacy metadata values.
-- They live in a separate append-only table so the five pilot archive rows can
-- be enriched without updating their already-preserved immutable values.
CREATE TABLE IF NOT EXISTS dms_legacy_content_file_details (
    source_system             TEXT NOT NULL,
    legacy_content_version_id BIGINT NOT NULL,
    source_file_modified_at   TIMESTAMPTZ,
    observed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_system, legacy_content_version_id),
    FOREIGN KEY (source_system, legacy_content_version_id)
        REFERENCES dms_legacy_content_versions(source_system, legacy_content_version_id)
        ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS dms_legacy_migration_exceptions (
    source_system       TEXT NOT NULL,
    legacy_document_id  BIGINT NOT NULL,
    exception_type      TEXT NOT NULL,
    reason_code         TEXT NOT NULL,
    reason              TEXT NOT NULL,
    details             JSONB NOT NULL DEFAULT '{}'::jsonb,
    migration_run_id    UUID NOT NULL REFERENCES dms_legacy_migration_runs(run_id),
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at         TIMESTAMPTZ,
    PRIMARY KEY (source_system, legacy_document_id, exception_type),
    FOREIGN KEY (source_system, legacy_document_id)
        REFERENCES dms_legacy_source_documents(source_system, legacy_document_id)
        ON DELETE RESTRICT,
    CHECK (exception_type IN ('source_file', 'owner_business_input', 'technical'))
);

DROP TRIGGER IF EXISTS trg_legacy_source_documents_append_only ON dms_legacy_source_documents;
CREATE TRIGGER trg_legacy_source_documents_append_only
BEFORE UPDATE OR DELETE ON dms_legacy_source_documents
FOR EACH ROW EXECUTE FUNCTION dms_reject_legacy_provenance_mutation();

DROP TRIGGER IF EXISTS trg_legacy_content_file_details_append_only ON dms_legacy_content_file_details;
CREATE TRIGGER trg_legacy_content_file_details_append_only
BEFORE UPDATE OR DELETE ON dms_legacy_content_file_details
FOR EACH ROW EXECUTE FUNCTION dms_reject_legacy_provenance_mutation();
