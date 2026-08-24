# Migration Changelog

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
