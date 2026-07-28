-- Persists the ISO audit journey calendar shown on the Dashboard. It previously
-- lived only in AuditCalendarCard.tsx's useState, so every entry vanished on
-- refresh. google_event_id is nullable and set once an event is pushed to the
-- shared company Google Calendar (see AuditCalendarService.SyncEventAsync) —
-- null just means "not synced yet" (or Google sync isn't configured), not an error.

CREATE TABLE IF NOT EXISTS dms_audit_calendar_events (
    event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           VARCHAR(255) NOT NULL,
    phase           VARCHAR(50) NOT NULL,
    standard        VARCHAR(50) NOT NULL,
    event_date      DATE NOT NULL,
    notes           TEXT,
    posted_by       UUID NOT NULL REFERENCES dms_users(user_id),
    google_event_id VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_audit_calendar_phase CHECK (phase IN (
        'Internal Audit', 'Stage 1 Audit', 'Stage 2 Audit',
        'Surveillance Audit', 'Recertification Audit', 'Management Review'
    )),
    CONSTRAINT chk_audit_calendar_standard CHECK (standard IN (
        'ISO 9001:2015', 'ISO 27001:2022', 'Both'
    ))
);

CREATE INDEX IF NOT EXISTS idx_audit_calendar_events_date ON dms_audit_calendar_events (event_date);
