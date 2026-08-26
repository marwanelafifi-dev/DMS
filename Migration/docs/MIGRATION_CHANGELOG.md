# Migration Changelog

## 2026-08-25 — Migrated document deletion

- Enabled permanent deletion for migrated and native New-DMS documents.
- Added one-way legacy target tombstones so deleted New-DMS document/version UUIDs remain traceable.
- Preserved all KnowledgeTree metadata snapshots, content-version rows, and archived physical files.
- Made PostgreSQL document deletion transactional and delayed MinIO cleanup until after commit.
- Added database and live API delete regression checks.

## 2026-08-24 — Full controlled migration

- Added exact metadata-snapshot to content-version/file association in the Legacy Metadata History API and UI.
- Added authorized read-only historical View/Download endpoints.
- Exposed Category in document details and configurable library columns.
- Added the full archive/source/exception schema extension and resumable migration runner.
- Created and verified a fresh PostgreSQL and MinIO backup before full execution.
- Validated/skipped the five pilots and migrated 884 additional documents.
- Archived all 7,662 metadata snapshots and all 2,607 legacy content-version rows.
- Quarantined 10 source-file and 109 owner/business exceptions without invented data.
- Reconciled PostgreSQL, MinIO, archive object sets, folder/owner/category mappings, and 31 normal API samples.

## 2026-08-24 — Application UX cleanup

- Corrected Legacy Metadata History `View` to use the shared read-only preview pipeline while keeping `Download` separate.
- Added recursive Expand All and Collapse All controls to the Document Library folder tree.
- Added reusable Tags support to PCAR across PostgreSQL, backend APIs, create/edit/detail flows, and the PCAR register.
- Standardized true modal behavior: top-most Escape and explicit controls close; backdrop clicks do not.
- Removed the Compliance/ISO and On-Premises Vault decorations from the sidebar while retaining existing navigation and build information.
- Added the idempotent `081_task_tags.sql` schema change; KnowledgeTree migration data and archive files were not changed.
