# Full Migration Execution and Continuation

The full migration was executed, not left as a dry-run plan. Run key `knowledge-tree-full-migration-v1` owns 884 active mappings; the earlier pilot run owns five.

`full_migration.py --execute --backup-dir <verified-backup>` is safely resumable. Existing deterministic mappings are validated, existing MinIO hashes are verified, folders/dropdowns/users are reused, and archive/object conflicts are idempotent. One document failure does not roll back prior committed documents.

The remaining work is business/source remediation only:

1. provide exact document-level owner decisions for the 40 split cases;
2. provide authoritative emails/identities for the five unresolved approved owners affecting 69 documents;
3. provide genuine source files for the 10 file exceptions if they are recoverable;
4. rerun the same execution command and reconcile again.

No historical KnowledgeTree workflow or permission import is planned.
