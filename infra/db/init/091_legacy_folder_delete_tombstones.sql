-- Allow folders imported from a legacy source to be permanently deleted from
-- the New-DMS Recycle Bin without deleting their immutable migration evidence.
--
-- The live target reference becomes nullable and uses ON DELETE SET NULL. A
-- guarded one-way trigger preserves the last live UUID in a tombstone column,
-- matching the document behavior introduced by migration 082.

ALTER TABLE dms_legacy_folder_mappings
    ADD COLUMN IF NOT EXISTS deleted_new_folder_id UUID,
    ADD COLUMN IF NOT EXISTS target_deleted_at TIMESTAMPTZ;

ALTER TABLE dms_legacy_folder_mappings
    ALTER COLUMN new_folder_id DROP NOT NULL;

DROP TRIGGER IF EXISTS trg_legacy_folder_mappings_append_only
    ON dms_legacy_folder_mappings;

CREATE OR REPLACE FUNCTION dms_guard_legacy_folder_mapping_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    folder_detached BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Legacy migration provenance is append-only';
    END IF;

    IF NEW.source_system IS DISTINCT FROM OLD.source_system
       OR NEW.legacy_folder_id IS DISTINCT FROM OLD.legacy_folder_id
       OR NEW.legacy_full_path IS DISTINCT FROM OLD.legacy_full_path
       OR NEW.migration_run_id IS DISTINCT FROM OLD.migration_run_id
       OR NEW.mapped_at IS DISTINCT FROM OLD.mapped_at THEN
        RAISE EXCEPTION 'Legacy migration provenance is append-only';
    END IF;

    folder_detached := OLD.new_folder_id IS NOT NULL
        AND NEW.new_folder_id IS NULL;

    IF NEW.new_folder_id IS DISTINCT FROM OLD.new_folder_id
       AND NOT folder_detached THEN
        RAISE EXCEPTION 'Legacy migration target references can only be detached';
    END IF;

    IF folder_detached THEN
        NEW.deleted_new_folder_id := COALESCE(
            OLD.deleted_new_folder_id,
            OLD.new_folder_id
        );
        NEW.target_deleted_at := COALESCE(OLD.target_deleted_at, now());
    ELSE
        IF NEW.deleted_new_folder_id IS DISTINCT FROM OLD.deleted_new_folder_id THEN
            RAISE EXCEPTION 'Legacy migration tombstones are immutable';
        END IF;
        IF NEW.target_deleted_at IS DISTINCT FROM OLD.target_deleted_at THEN
            RAISE EXCEPTION 'Legacy migration tombstones are immutable';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

ALTER TABLE dms_legacy_folder_mappings
    DROP CONSTRAINT IF EXISTS dms_legacy_folder_mappings_new_folder_id_fkey;
ALTER TABLE dms_legacy_folder_mappings
    ADD CONSTRAINT dms_legacy_folder_mappings_new_folder_id_fkey
    FOREIGN KEY (new_folder_id)
    REFERENCES dms_folders(folder_id)
    ON DELETE SET NULL;

CREATE TRIGGER trg_legacy_folder_mappings_append_only
BEFORE UPDATE OR DELETE ON dms_legacy_folder_mappings
FOR EACH ROW EXECUTE FUNCTION dms_guard_legacy_folder_mapping_mutation();

COMMENT ON COLUMN dms_legacy_folder_mappings.deleted_new_folder_id IS
    'Immutable UUID of the active New-DMS folder after that target is deleted.';
COMMENT ON COLUMN dms_legacy_folder_mappings.target_deleted_at IS
    'Time the active New-DMS folder reference was detached by deletion.';
