-- Migration 062: small global key/value settings table, starting with
-- "sync Google Calendar automatically on every login" (Full Access-only toggle).
CREATE TABLE IF NOT EXISTS dms_app_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by_id UUID REFERENCES dms_users(user_id) ON DELETE SET NULL
);

INSERT INTO dms_app_settings (key, value)
VALUES ('sync_calendar_on_login', 'false')
ON CONFLICT (key) DO NOTHING;
