# Implemented Migration Architecture

The full runner is `Migration/scripts/full_migration.py`. It reads the SQL dump, reconstructed metadata TSV, approved owner workbooks, and physical blob export.

For each source document it:

1. resolves the current metadata pointer and its exact content version;
2. validates the active source file and legacy MD5;
3. resolves owner identity, department, category, and folder mapping;
4. writes the source registration, every metadata snapshot, and every content-version record;
5. uploads the current file to the normal document namespace only for safe documents;
6. uploads other available files to `legacy/archive/KnowledgeTree/...`;
7. commits one document transaction and records deterministic legacy/new mappings.

The archive schema separates source registration from active document mapping, so an exception can retain evidence without pretending migration success. Archive provenance tables are append-only. `dms_legacy_content_file_details` retains observed physical dates, and `dms_legacy_migration_exceptions` stores exact unresolved reasons.

An active New-DMS document may be permanently deleted without deleting its KnowledgeTree evidence. `082_legacy_document_delete_tombstones.sql` changes only the live target references to `ON DELETE SET NULL`; a guarded one-way trigger preserves the deleted document/version UUIDs and first deletion time in immutable tombstone columns. Metadata snapshots, legacy content rows, and archived physical files remain unchanged.

The API joins each metadata snapshot's real `legacy_content_version_id` to its content record. Historical View/Download reads the archive namespace and never creates a native New-DMS version.
