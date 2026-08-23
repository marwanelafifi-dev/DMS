-- KnowledgeTree migration provenance and legacy archive.
--
-- Only the current KnowledgeTree state belongs in dms_documents and
-- dms_document_versions.  The tables below retain source mappings and legacy
-- history without turning that history into normal New-DMS workflow/version
-- records.  They are intentionally source-system keyed so a later migration
-- can reuse the same model without relying on pilot-specific UUIDs.

CREATE TABLE IF NOT EXISTS dms_legacy_migration_runs (
    run_id                  UUID PRIMARY KEY,
    source_system           TEXT NOT NULL,
    run_key                 TEXT NOT NULL,
    status                  TEXT NOT NULL,
    source_manifest_sha256  TEXT NOT NULL,
    details                 JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at            TIMESTAMPTZ,
    UNIQUE (source_system, run_key),
    CHECK (status IN ('started', 'cleanup_complete', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS dms_legacy_folder_mappings (
    source_system       TEXT NOT NULL,
    legacy_folder_id    BIGINT NOT NULL,
    legacy_full_path    TEXT NOT NULL,
    new_folder_id       UUID NOT NULL REFERENCES dms_folders(folder_id) ON DELETE RESTRICT,
    migration_run_id    UUID NOT NULL REFERENCES dms_legacy_migration_runs(run_id),
    mapped_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_system, legacy_folder_id),
    UNIQUE (new_folder_id)
);

CREATE TABLE IF NOT EXISTS dms_legacy_document_mappings (
    source_system                    TEXT NOT NULL,
    legacy_document_id               BIGINT NOT NULL,
    new_document_id                  UUID NOT NULL REFERENCES dms_documents(document_id) ON DELETE RESTRICT,
    active_legacy_content_version_id BIGINT NOT NULL,
    active_new_version_id            UUID NOT NULL REFERENCES dms_document_versions(version_id) ON DELETE RESTRICT,
    migration_run_id                 UUID NOT NULL REFERENCES dms_legacy_migration_runs(run_id),
    migrated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_system, legacy_document_id),
    UNIQUE (new_document_id),
    UNIQUE (active_new_version_id)
);

CREATE TABLE IF NOT EXISTS dms_legacy_metadata_snapshots (
    source_system              TEXT NOT NULL,
    legacy_metadata_version_id BIGINT NOT NULL,
    legacy_document_id         BIGINT NOT NULL,
    legacy_content_version_id  BIGINT,
    metadata_sequence          INTEGER NOT NULL,
    title                      TEXT,
    description                TEXT,
    original_authors           TEXT,
    ip_number                  TEXT,
    internal_external          TEXT,
    original_document_number   TEXT,
    legacy_group               TEXT,
    legacy_document_type       TEXT,
    legacy_tags                TEXT,
    is_current_snapshot        BOOLEAN NOT NULL,
    snapshot_created_at        TIMESTAMPTZ,
    raw_metadata               JSONB NOT NULL,
    archived_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_system, legacy_metadata_version_id),
    FOREIGN KEY (source_system, legacy_document_id)
        REFERENCES dms_legacy_document_mappings(source_system, legacy_document_id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_legacy_metadata_document
    ON dms_legacy_metadata_snapshots(source_system, legacy_document_id, metadata_sequence);

CREATE TABLE IF NOT EXISTS dms_legacy_content_versions (
    source_system             TEXT NOT NULL,
    legacy_content_version_id BIGINT NOT NULL,
    legacy_document_id        BIGINT NOT NULL,
    major_version             INTEGER NOT NULL,
    minor_version             INTEGER NOT NULL,
    original_filename         TEXT NOT NULL,
    source_storage_path       TEXT,
    source_size_bytes         BIGINT,
    source_md5                TEXT,
    is_active_source          BOOLEAN NOT NULL,
    physical_file_status      TEXT NOT NULL,
    archive_object_key        TEXT,
    archive_sha256            TEXT,
    archived_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_system, legacy_content_version_id),
    FOREIGN KEY (source_system, legacy_document_id)
        REFERENCES dms_legacy_document_mappings(source_system, legacy_document_id)
        ON DELETE RESTRICT,
    UNIQUE (archive_object_key),
    CHECK (physical_file_status IN (
        'active_in_new_dms',
        'archived',
        'source_file_missing',
        'source_file_zero_byte',
        'source_md5_mismatch'
    )),
    CHECK (
        (physical_file_status = 'archived' AND archive_object_key IS NOT NULL AND archive_sha256 IS NOT NULL)
        OR
        (physical_file_status <> 'archived' AND archive_object_key IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_legacy_content_document
    ON dms_legacy_content_versions(source_system, legacy_document_id, major_version, minor_version);

-- Existing volumes may have been initialized with an earlier pilot draft that
-- used cascading provenance FKs.  Replace those constraints idempotently so a
-- normal New-DMS delete cannot erase legacy evidence transitively.
ALTER TABLE dms_legacy_folder_mappings
    DROP CONSTRAINT IF EXISTS dms_legacy_folder_mappings_new_folder_id_fkey;
ALTER TABLE dms_legacy_folder_mappings
    ADD CONSTRAINT dms_legacy_folder_mappings_new_folder_id_fkey
    FOREIGN KEY (new_folder_id) REFERENCES dms_folders(folder_id) ON DELETE RESTRICT;

ALTER TABLE dms_legacy_document_mappings
    DROP CONSTRAINT IF EXISTS dms_legacy_document_mappings_new_document_id_fkey;
ALTER TABLE dms_legacy_document_mappings
    ADD CONSTRAINT dms_legacy_document_mappings_new_document_id_fkey
    FOREIGN KEY (new_document_id) REFERENCES dms_documents(document_id) ON DELETE RESTRICT;
ALTER TABLE dms_legacy_document_mappings
    DROP CONSTRAINT IF EXISTS dms_legacy_document_mappings_active_new_version_id_fkey;
ALTER TABLE dms_legacy_document_mappings
    ADD CONSTRAINT dms_legacy_document_mappings_active_new_version_id_fkey
    FOREIGN KEY (active_new_version_id) REFERENCES dms_document_versions(version_id) ON DELETE RESTRICT;

ALTER TABLE dms_legacy_metadata_snapshots
    DROP CONSTRAINT IF EXISTS dms_legacy_metadata_snapshots_source_system_legacy_documen_fkey;
ALTER TABLE dms_legacy_metadata_snapshots
    ADD CONSTRAINT dms_legacy_metadata_snapshots_source_system_legacy_documen_fkey
    FOREIGN KEY (source_system, legacy_document_id)
    REFERENCES dms_legacy_document_mappings(source_system, legacy_document_id) ON DELETE RESTRICT;

ALTER TABLE dms_legacy_content_versions
    DROP CONSTRAINT IF EXISTS dms_legacy_content_versions_source_system_legacy_document__fkey;
ALTER TABLE dms_legacy_content_versions
    ADD CONSTRAINT dms_legacy_content_versions_source_system_legacy_document__fkey
    FOREIGN KEY (source_system, legacy_document_id)
    REFERENCES dms_legacy_document_mappings(source_system, legacy_document_id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION dms_reject_legacy_provenance_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Legacy migration provenance is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_legacy_folder_mappings_append_only ON dms_legacy_folder_mappings;
CREATE TRIGGER trg_legacy_folder_mappings_append_only
BEFORE UPDATE OR DELETE ON dms_legacy_folder_mappings
FOR EACH ROW EXECUTE FUNCTION dms_reject_legacy_provenance_mutation();

DROP TRIGGER IF EXISTS trg_legacy_document_mappings_append_only ON dms_legacy_document_mappings;
CREATE TRIGGER trg_legacy_document_mappings_append_only
BEFORE UPDATE OR DELETE ON dms_legacy_document_mappings
FOR EACH ROW EXECUTE FUNCTION dms_reject_legacy_provenance_mutation();

DROP TRIGGER IF EXISTS trg_legacy_metadata_snapshots_append_only ON dms_legacy_metadata_snapshots;
CREATE TRIGGER trg_legacy_metadata_snapshots_append_only
BEFORE UPDATE OR DELETE ON dms_legacy_metadata_snapshots
FOR EACH ROW EXECUTE FUNCTION dms_reject_legacy_provenance_mutation();

DROP TRIGGER IF EXISTS trg_legacy_content_versions_append_only ON dms_legacy_content_versions;
CREATE TRIGGER trg_legacy_content_versions_append_only
BEFORE UPDATE OR DELETE ON dms_legacy_content_versions
FOR EACH ROW EXECUTE FUNCTION dms_reject_legacy_provenance_mutation();
