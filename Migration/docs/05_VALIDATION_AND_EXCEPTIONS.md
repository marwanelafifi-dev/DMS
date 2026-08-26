# Validation and Exceptions

Full reconciliation compared all 1,008 source documents with PostgreSQL, MinIO, and the Legacy Archive. It recalculated source MD5/SHA-256 values, read stored objects, checked exact current-version relationships, reconciled object sets, and sampled 31 active documents through the normal API across departments/categories.

All 889 active documents passed. All 119 quarantined source rows passed archive validation. No technical migration failure or migration-object orphan remains.

## Source exceptions

- Zero-byte active files: 164, 507
- Current-pointer blobs absent from the export: 422, 928, 1175, 1176, 1177, 1178, 1190, 1294

## Owner/business-input exceptions

- Split owner assignments (40 documents): exact IDs and candidate owners are recorded in `16_full_migration_exceptions.csv`.
- Missing authoritative user email/identity (69 documents): Belal Magdy, Hossam Karim, Marwan Elafifi, Mohamed Gaber, and Sebastien Nazeer.

No exception was counted as an active success. Its metadata and available legacy physical files remain preserved.
