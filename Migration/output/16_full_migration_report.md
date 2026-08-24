# Full KnowledgeTree Migration Report

**Result:** PARTIAL SUCCESS

This is the actual execution result, not a plan or dry run. The current KnowledgeTree metadata pointer selected every active file; no numerically-highest substitute was used.

## Reconciliation

- Legacy documents: 1008
- Pilot documents validated/skipped: 5
- Newly migrated: 884
- Previously migrated full-run rows: 0
- Total active New-DMS documents: 889
- Source-file exceptions: 10
- Owner/business-input exceptions: 109
- Technical failures: 0
- Legacy metadata snapshots archived: 7662
- Legacy content-version rows archived: 2607
- Migration active MinIO objects: 889
- Legacy Archive MinIO objects: 907
- API sample documents: 31
- PostgreSQL relationship/metadata reconciliation: PASS
- MinIO hash/object-set reconciliation: PASS
- Application/API samples: PASS
- Orphan/object-set reconciliation: PASS

## Owner identity boundary

- Belal Magdy: Exact legacy account exists but has no authoritative email
- Hossam Karim: No exact authoritative legacy/New-DMS account with email
- Marwan Elafifi: Exact legacy account exists but has no authoritative email
- Mohamed Gaber: No exact authoritative legacy/New-DMS account with email
- Sebastien Nazeer: Exact legacy account exists but has no authoritative email

Every exception is enumerated with its exact legacy document ID in `16_full_migration_exceptions.csv`.
