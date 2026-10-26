# Ubuntu Deployment Runbook

The production-style deployment runs the same Compose project on an x86_64 Ubuntu host. Transfer a logical PostgreSQL dump, the MinIO and OCR named-volume archives, the exact application images, the source release, and the uncommitted `.env` secret file. Do not copy running container filesystems as the source of record.

## Current target

- Host observed during the 2026-10-26 recovery: `192.168.2.190` (`dms-virtual-machine`). Confirm the current address before connecting.
- Application entry point during LAN validation: `http://<current-host-ip>:8888`
- Internal services (PostgreSQL, Redis, MinIO, OCR, API, direct web, and the Traefik dashboard) bind to host loopback only.
- The browser reaches OCR through the same-origin `/ocr/` proxy. It must never call `127.0.0.1:8000` on an employee workstation.
- The gateway is pinned to Traefik `3.6.12`. Older 3.1 releases negotiate an unsupported Docker API with Docker Engine 29, and 3.6.13 regressed the same provider behavior.

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

For the remotely managed Cloudflare Tunnel, keep `CLOUDFLARE_TUNNEL_TOKEN` only in the mode-`0600` `.env`, start the `tunnel` profile, and route the public hostname to `http://traefik:80` on the Compose network. The connector uses outbound connections only; do not add a public host port for `cloudflared`.

## Rollback

Keep the source system and transfer artifacts intact until acceptance. Never allow users to write to both source and target. If target validation fails, stop the target stack and resume the source; if target use has already begun, take a fresh target snapshot before deciding which environment remains authoritative.

## Recovery backup disk incident (2026-10-26)

The live `/opt/dms` API container accumulated roughly 198 GB of `/tmp/dms-recovery-*.zip` files. PostgreSQL then reported `No space left on device` and entered a recovery loop. The source cause was the optional SMB copy reading a complete 6.8 GB ZIP into one byte array, followed by a cleanup path that only ran on success. Hangfire retried the failed backup every five minutes and could overlap earlier runs.

To recover disk space without touching `dms_pgdata` or `dms_miniodata`, stop and remove **only** the API container. Do not use `docker compose down -v`, `docker volume prune`, or delete anything in the PostgreSQL or MinIO volumes.

```bash
cd /opt/dms
docker compose stop -t 20 api
docker compose rm -f api
df -h /
docker compose ps postgres minio
```

Wait for PostgreSQL to become healthy. Before starting the old API image, pause its backup scheduler in the settings table. This changes only `Enabled`; it preserves the destination, credentials, and other schedule fields and prints no credentials.

```bash
docker compose exec -T postgres sh -c 'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
UPDATE dms_app_settings
SET value = jsonb_set(value::jsonb, '{Enabled}', 'false'::jsonb)::text,
    updated_at = now()
WHERE key = 'scheduled_backup_config';
SELECT key, value::jsonb->>'Enabled' AS enabled
FROM dms_app_settings
WHERE key = 'scheduled_backup_config';
SQL
docker compose up -d --no-deps --no-build api
docker compose ps api postgres minio
```

The corrected API streams the SMB copy in 64 KB chunks, removes temporary archives in `finally`, serializes backup runs, clears orphaned temporary archives before a new run, checks space for the upload staging file and MinIO object while leaving a 10 GB disk reserve, and retains ZIPs by their embedded timestamp across frequencies. A mounted destination is copied through a `.partial` file and renamed only after completion. The code fix needs an API rebuild and container recreation; no SQL migration is needed for this fix.

Before enabling backups again, set `KeepLastN` to a number the Ubuntu disk can hold. At about 6.8 GB per backup, 30 MinIO copies alone need about 204 GB, in addition to the live documents and temporary archive. Verify the Synology mount is writable from the API container and run one manual backup; confirm the ZIP is present and readable on Synology, then check `df -h /` and `docker ps --size` before enabling the schedule.
