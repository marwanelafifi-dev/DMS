\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    test_run_id CONSTANT UUID := 'ffffffff-ffff-4fff-8fff-fffffffffff1';
    test_document_id CONSTANT UUID := 'ffffffff-ffff-4fff-8fff-fffffffffff2';
    test_version_id CONSTANT UUID := 'ffffffff-ffff-4fff-8fff-fffffffffff3';
    test_legacy_document_id CONSTANT BIGINT := -900000000000001;
    test_legacy_content_id CONSTANT BIGINT := -900000000000002;
    test_legacy_metadata_id CONSTANT BIGINT := -900000000000003;
    test_folder_id UUID;
    test_owner_id UUID;
    mapping_row RECORD;
BEGIN
    SELECT folder_id INTO test_folder_id FROM dms_folders ORDER BY created_at LIMIT 1;
    SELECT user_id INTO test_owner_id FROM dms_users WHERE is_active ORDER BY created_at LIMIT 1;

    IF test_folder_id IS NULL OR test_owner_id IS NULL THEN
        RAISE EXCEPTION 'The delete regression test requires one folder and one active user';
    END IF;

    INSERT INTO dms_legacy_migration_runs (
        run_id, source_system, run_key, status, source_manifest_sha256, completed_at
    ) VALUES (
        test_run_id,
        'DeleteRegression',
        'delete-regression',
        'completed',
        repeat('0', 64),
        now()
    );

    INSERT INTO dms_legacy_source_documents (
        source_system, legacy_document_id, first_migration_run_id
    ) VALUES (
        'DeleteRegression', test_legacy_document_id, test_run_id
    );

    INSERT INTO dms_documents (
        document_id, folder_id, title, status, owner_id
    ) VALUES (
        test_document_id, test_folder_id, 'Migrated delete regression fixture', 'draft', test_owner_id
    );

    INSERT INTO dms_document_versions (
        version_id,
        document_id,
        version_number,
        file_name,
        file_size_bytes,
        mime_type,
        s3_object_key,
        sha256_hash,
        status
    ) VALUES (
        test_version_id,
        test_document_id,
        '1.0',
        'migrated-delete-regression.txt',
        7,
        'text/plain',
        'delete-regression/migrated-delete-regression.txt',
        repeat('0', 64),
        'draft'
    );

    UPDATE dms_documents
    SET current_version_id = test_version_id
    WHERE document_id = test_document_id;

    INSERT INTO dms_legacy_document_mappings (
        source_system,
        legacy_document_id,
        new_document_id,
        active_legacy_content_version_id,
        active_new_version_id,
        migration_run_id
    ) VALUES (
        'DeleteRegression',
        test_legacy_document_id,
        test_document_id,
        test_legacy_content_id,
        test_version_id,
        test_run_id
    );

    INSERT INTO dms_legacy_metadata_snapshots (
        source_system,
        legacy_metadata_version_id,
        legacy_document_id,
        legacy_content_version_id,
        metadata_sequence,
        title,
        is_current_snapshot,
        raw_metadata
    ) VALUES (
        'DeleteRegression',
        test_legacy_metadata_id,
        test_legacy_document_id,
        test_legacy_content_id,
        1,
        'Migrated delete regression fixture',
        TRUE,
        '{"Title":"Migrated delete regression fixture"}'::jsonb
    );

    INSERT INTO dms_legacy_content_versions (
        source_system,
        legacy_content_version_id,
        legacy_document_id,
        major_version,
        minor_version,
        original_filename,
        source_size_bytes,
        is_active_source,
        physical_file_status
    ) VALUES (
        'DeleteRegression',
        test_legacy_content_id,
        test_legacy_document_id,
        1,
        0,
        'migrated-delete-regression.txt',
        7,
        TRUE,
        'source_file_missing'
    );

    UPDATE dms_documents
    SET current_version_id = NULL
    WHERE document_id = test_document_id;
    DELETE FROM dms_document_versions WHERE version_id = test_version_id;
    DELETE FROM dms_documents WHERE document_id = test_document_id;

    SELECT * INTO STRICT mapping_row
    FROM dms_legacy_document_mappings
    WHERE source_system = 'DeleteRegression'
      AND legacy_document_id = test_legacy_document_id;

    IF mapping_row.new_document_id IS NOT NULL
       OR mapping_row.active_new_version_id IS NOT NULL
       OR mapping_row.deleted_new_document_id IS DISTINCT FROM test_document_id
       OR mapping_row.deleted_active_new_version_id IS DISTINCT FROM test_version_id
       OR mapping_row.target_deleted_at IS NULL THEN
        RAISE EXCEPTION 'Legacy target mapping was not tombstoned correctly';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM dms_legacy_metadata_snapshots
        WHERE source_system = 'DeleteRegression'
          AND legacy_metadata_version_id = test_legacy_metadata_id
    ) OR NOT EXISTS (
        SELECT 1 FROM dms_legacy_content_versions
        WHERE source_system = 'DeleteRegression'
          AND legacy_content_version_id = test_legacy_content_id
    ) THEN
        RAISE EXCEPTION 'Legacy archive evidence was removed with the active document';
    END IF;
END;
$$;

ROLLBACK;

\echo 'Migrated document deletion preserves Legacy Archive: PASS'
