# Ubuntu Deployment Runbook

The production-style deployment runs the same Compose project on an x86_64 Ubuntu host. Transfer a logical PostgreSQL dump, the MinIO and OCR named-volume archives, the exact application images, the source release, and the uncommitted `.env` secret file. Do not copy running container filesystems as the source of record.

## Current target

- Host: `192.168.1.185`
- Application entry point during LAN validation: `http://192.168.1.185:8888`
- Internal services (PostgreSQL, Redis, MinIO, OCR, API, direct web, and the Traefik dashboard) bind to host loopback only.
- The browser reaches OCR through the same-origin `/ocr/` proxy. It must never call `127.0.0.1:8000` on an employee workstation.

## Transfer artifacts

Create the artifacts while API, web, OCR, MinIO, and the gateway are stopped so the database and object-store snapshot describe the same application state:

- `postgres.dump`: PostgreSQL custom-format dump.
- `minio-data.tar.gz`: complete `dms_miniodata` volume.
- `ocr-data.tar.gz`: complete `dms_ocrdata` volume.
- `dms-images.tar`: exact Docker images used for the release.
- `dms-source.bundle`: Git source bundle for the committed release.
- `.env`: production secrets, transferred separately and stored with mode `0600`.
- `SHA256SUMS`: checksums verified before and after transfer.

Redis is intentionally not migrated because it contains transient cache/job state; durable Hangfire state is in PostgreSQL.

## Restore order

1. Verify every artifact checksum.
2. Load `dms-images.tar`.
3. Restore the MinIO and OCR archives into new, empty `dms_miniodata` and `dms_ocrdata` volumes.
4. Start PostgreSQL alone and restore `postgres.dump` with `--clean --if-exists --exit-on-error --no-owner --no-privileges`.
5. Start the complete Compose project without rebuilding the transferred images.
6. Wait for every health check and reconcile database counts with the source snapshot.
7. Validate login, folders, active files, hashes, previews, downloads, legacy history, OCR, upload, and an expendable create/delete lifecycle through the normal gateway.

## Production completion

The IP/port URL is for LAN validation. Before general use, put the gateway behind the company HTTPS endpoint, update `GOOGLE_CALENDAR_REDIRECT_URI` and `GOOGLE_FRONTEND_REDIRECT_URL`, and register the HTTPS callback with Google if those integrations are enabled. Do not expose ports 5432, 6379, 8000, 8080, 9000, 9001, or 8090 to the LAN.

## Rollback

Keep the source system and transfer artifacts intact until acceptance. Never allow users to write to both source and target. If target validation fails, stop the target stack and resume the source; if target use has already begun, take a fresh target snapshot before deciding which environment remains authoritative.
