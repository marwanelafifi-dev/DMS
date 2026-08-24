# Full Migration Rollback

Backup directory: `C:\Users\user\Desktop\DMS\Migration\backups\full_20260824_114730`

- PostgreSQL SHA-256: `90f26ed4334799bf3b7bc7e08c0920e45570eb934186618a73731f3dc07f4a95`
- MinIO SHA-256: `a2cce49fe6e036bf90857a0c1ce649d529888afb1d3dd6971a43ef7329e9118b`

Rollback is destructive to all local changes made after the snapshot. Verify both hashes, stop `api`, `web`, and `minio`, and copy `postgres_pre_migration.dump` into the PostgreSQL container. Terminate connections to the configured local `dms` database, recreate it, then restore with `pg_restore --exit-on-error --no-owner --no-privileges -U dms_app -d dms`. Resolve the exact MinIO `/data` volume with `docker inspect`; mount only that volume and the backup directory in a temporary container, clear `/data`, and extract `minio_pre_migration.tar.gz`. Restart the services, wait for health checks, and rerun the five-pilot API/hash validation. Both backup artifacts were read completely and accepted by `verify_backup` before execution. Rollback has not been run.
