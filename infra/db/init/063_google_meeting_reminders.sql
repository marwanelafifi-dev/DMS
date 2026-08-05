-- Migration 063: tracks which of the 3 reminder stages (created / day-before /
-- 10-minutes-before) have already fired for an "ISO"-titled Google Calendar
-- meeting. Keyed by the event itself (not per connected user) because a
-- meeting's reminders go out to every real attendee's email address pulled
-- from the event — not just whichever DMS account happened to have its
-- calendar connected and get scanned first. The events themselves are never
-- persisted beyond this snapshot; the attendee list is captured once at
-- first-sight so later stages don't need to re-fetch the event.
CREATE TABLE IF NOT EXISTS dms_google_meeting_reminders (
    reminder_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    google_event_id VARCHAR(255) NOT NULL UNIQUE,
    title TEXT NOT NULL,
    meeting_start TIMESTAMPTZ NOT NULL,
    attendee_emails TEXT[] NOT NULL DEFAULT '{}',
    created_reminder_sent BOOLEAN NOT NULL DEFAULT false,
    day_before_reminder_sent BOOLEAN NOT NULL DEFAULT false,
    ten_min_reminder_sent BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_meeting_reminders_meeting_start ON dms_google_meeting_reminders(meeting_start);
