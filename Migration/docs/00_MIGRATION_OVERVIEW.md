# KnowledgeTree Migration Overview

The local KnowledgeTree-to-New-DMS migration was executed on 24 August 2026. It migrated the current KnowledgeTree state as active New-DMS data and retained legacy evidence in a separate read-only archive.

## Actual result

- Source documents: 1,008
- Previously completed pilot: 5 (validated and skipped idempotently)
- Newly migrated in the full run: 884
- Active New-DMS documents: 889
- Source-file exceptions: 10
- Owner/business-input exceptions: 109
- Technical failures: 0
- Archived metadata snapshots: 7,662
- Archived content-version records: 2,607
- Archived physical file objects: 907

Every source document has a `dms_legacy_source_documents` row. Exceptions retain metadata and available physical evidence without a fake active document. The exact per-document result is in `Migration/output/16_full_migration_validation.csv` and `16_full_migration_exceptions.csv`.

The migration is resumable through deterministic UUIDs/object keys, source-to-target mapping tables, per-document PostgreSQL transactions, and idempotent object verification.
