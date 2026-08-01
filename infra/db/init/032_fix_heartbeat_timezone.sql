-- Migration 032: Fix dms_users.last_heartbeat_at timezone type mismatch
-- 022_auth_session_tracking.sql created this column as TIMESTAMP (no time
-- zone), unlike every other timestamp column in the schema and unlike the EF
-- Core model, which expects timestamptz for DateTime? properties. Postgres
-- silently accepted writes (the app always writes DateTime.UtcNow), but any
-- EF SaveChanges that uses the generic dbSet.Update(entity) pattern — which
-- marks every scalar property as modified, not just the ones actually
-- changed — forces this column into the UPDATE statement too. Npgsql then
-- refuses because the in-memory value has Kind=Unspecified (read back from a
-- non-tz column) while the destination is typed timestamptz, throwing
-- "Cannot write DateTime with Kind=Unspecified to PostgreSQL type
-- 'timestamp with time zone'" for any user who has ever sent a heartbeat —
-- i.e. any user who has ever actually logged in. This broke every
-- PUT /api/users/{id} (and the new PUT /api/users/{id}/role) for such users.
-- Date: 2026-08-01

ALTER TABLE dms_users
    ALTER COLUMN last_heartbeat_at TYPE TIMESTAMPTZ USING last_heartbeat_at AT TIME ZONE 'UTC';
