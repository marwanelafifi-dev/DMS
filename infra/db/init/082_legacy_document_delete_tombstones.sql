-- Allow active New-DMS documents imported from a legacy source to be deleted
-- without deleting or rewriting their immutable Legacy Archive evidence.
--
-- The live target references become nullable and use ON DELETE SET NULL.  A
-- guarded one-way trigger copies their last values into tombstone columns so
-- provenance remains traceable after the active document/version is gone.

ALTER TABLE dms_legacy_document_mappings
    ADD COLUMN IF NOT EXISTS deleted_new_document_id UUID,
    ADD COLUMN IF NOT EXISTS deleted_active_new_version_id UUID,
    ADD COLUMN IF NOT EXISTS target_deleted_at TIMESTAMPTZ;

ALTER TABLE dms_legacy_document_mappings
    ALTER COLUMN new_document_id DROP NOT NULL,
    ALTER COLUMN active_new_version_id DROP NOT NULL;

DROP TRIGGER IF EXISTS trg_legacy_document_mappings_append_only
    ON dms_legacy_document_mappings;

CREATE OR REPLACE FUNCTION dms_guard_legacy_document_mapping_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    document_detached BOOLEAN;
    version_detached BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Legacy migration provenance is append-only';
    END IF;

    IF NEW.source_system IS DISTINCT FROM OLD.source_system
       OR NEW.legacy_document_id IS DISTINCT FROM OLD.legacy_document_id
       OR NEW.active_legacy_content_version_id IS DISTINCT FROM OLD.active_legacy_content_version_id
       OR NEW.migration_run_id IS DISTINCT FROM OLD.migration_run_id
       OR NEW.migrated_at IS DISTINCT FROM OLD.migrated_at THEN
        RAISE EXCEPTION 'Legacy migration provenance is append-only';
    END IF;

    document_detached := OLD.new_document_id IS NOT NULL
        AND NEW.new_document_id IS NULL;
    version_detached := OLD.active_new_version_id IS NOT NULL
        AND NEW.active_new_version_id IS NULL;

    IF NEW.new_document_id IS DISTINCT FROM OLD.new_document_id
       AND NOT document_detached THEN
        RAISE EXCEPTION 'Legacy migration target references can only be detached';
    END IF;

    IF NEW.active_new_version_id IS DISTINCT FROM OLD.active_new_version_id
       AND NOT version_detached THEN
        RAISE EXCEPTION 'Legacy migration target references can only be detached';
    END IF;

    IF document_detached THEN
        NEW.deleted_new_document_id := COALESCE(
            OLD.deleted_new_document_id,
            OLD.new_document_id
        );
    ELSIF NEW.deleted_new_document_id IS DISTINCT FROM OLD.deleted_new_document_id THEN
        RAISE EXCEPTION 'Legacy migration tombstones are immutable';
    END IF;

    IF version_detached THEN
        NEW.deleted_active_new_version_id := COALESCE(
            OLD.deleted_active_new_version_id,
            OLD.active_new_version_id
        );
    ELSIF NEW.deleted_active_new_version_id IS DISTINCT FROM OLD.deleted_active_new_version_id THEN
        RAISE EXCEPTION 'Legacy migration tombstones are immutable';
    END IF;

    IF document_detached OR version_detached THEN
        NEW.target_deleted_at := COALESCE(OLD.target_deleted_at, now());
    ELSIF NEW.target_deleted_at IS DISTINCT FROM OLD.target_deleted_at THEN
        RAISE EXCEPTION 'Legacy migration tombstones are immutable';
    END IF;

    RETURN NEW;
END;
$$;

ALTER TABLE dms_legacy_document_mappings
    DROP CONSTRAINT IF EXISTS dms_legacy_document_mappings_new_document_id_fkey;
ALTER TABLE dms_legacy_document_mappings
    ADD CONSTRAINT dms_legacy_document_mappings_new_document_id_fkey
    FOREIGN KEY (new_document_id)
    REFERENCES dms_documents(document_id)
    ON DELETE SET NULL;

ALTER TABLE dms_legacy_document_mappings
    DROP CONSTRAINT IF EXISTS dms_legacy_document_mappings_active_new_version_id_fkey;
ALTER TABLE dms_legacy_document_mappings
    ADD CONSTRAINT dms_legacy_document_mappings_active_new_version_id_fkey
    FOREIGN KEY (active_new_version_id)
    REFERENCES dms_document_versions(version_id)
    ON DELETE SET NULL;

CREATE TRIGGER trg_legacy_document_mappings_append_only
BEFORE UPDATE OR DELETE ON dms_legacy_document_mappings
FOR EACH ROW EXECUTE FUNCTION dms_guard_legacy_document_mapping_mutation();

COMMENT ON COLUMN dms_legacy_document_mappings.deleted_new_document_id IS
    'Immutable UUID of the active New-DMS document after that target is deleted.';
COMMENT ON COLUMN dms_legacy_document_mappings.deleted_active_new_version_id IS
    'Immutable UUID of the active New-DMS version after that target is deleted.';
COMMENT ON COLUMN dms_legacy_document_mappings.target_deleted_at IS
    'First time an active New-DMS target reference was detached by deletion.';
