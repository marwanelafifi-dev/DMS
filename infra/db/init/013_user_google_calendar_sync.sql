-- Replaces the one-shot "shared calendar" design from migration 012 (which added
-- dms_audit_calendar_events.google_event_id) with per-user Google Calendar sync:
-- every user connects their own Google account, gets a manual "Sync Now" button,
-- and is swept automatically once a day. A single shared-calendar event ID can't
-- represent "this audit event, as it appears on N different users' calendars",
-- so that column is dropped in favor of a per-(user, event) mapping table.
ALTER TABLE dms_audit_calendar_events DROP COLUMN IF EXISTS google_event_id;

-- One row per user who has connected their Google account. Tokens are stored as
-- opaque text for now — encrypting them at rest (e.g. via pgcrypto or an
-- application-layer KMS) is a real production requirement, tracked as a TODO
-- since this project doesn't have that infrastructure yet.
CREATE TABLE IF NOT EXISTS dms_user_calendar_connections (
    connection_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL UNIQUE REFERENCES dms_users(user_id) ON DELETE CASCADE,
    access_token      TEXT NOT NULL,
    refresh_token     TEXT NOT NULL,
    token_expires_at  TIMESTAMPTZ NOT NULL,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    connected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_synced_at    TIMESTAMPTZ,
    last_sync_error   TEXT
);

-- Tracks which audit events have already been pushed to which user's personal
-- calendar, and under what Google event ID — needed so a re-sync updates the
-- existing calendar entry instead of creating a duplicate every day.
CREATE TABLE IF NOT EXISTS dms_user_calendar_event_syncs (
    sync_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES dms_users(user_id) ON DELETE CASCADE,
    event_id        UUID NOT NULL REFERENCES dms_audit_calendar_events(event_id) ON DELETE CASCADE,
    google_event_id VARCHAR(255) NOT NULL,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, event_id)
);
