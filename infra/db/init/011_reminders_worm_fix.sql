-- Reminders is an operational scheduling table (due_date/is_sent/sent_at all need
-- to mutate), not a compliance ledger — it was mistakenly given the same WORM
-- trigger as dms_audit_trails/dms_esignatures/dms_ocr_indexes in 002_core_schema.sql,
-- which made every reminder permanently un-sendable and un-deletable. The real
-- audit-of-record for reminder lifecycle is the REMINDER_CREATED/REMINDER_SENT/
-- REMINDER_DELETED entries in dms_audit_trails, which stays WORM-protected.
DROP TRIGGER IF EXISTS trg_worm_reminders ON dms_reminders;
DROP FUNCTION IF EXISTS dms_reject_mutation_reminders();

-- due_date was DATE-only, silently truncating the time-of-day the frontend collects
-- via a datetime-local input (e.g. 09:00 became midnight).
ALTER TABLE dms_reminders
    ALTER COLUMN due_date TYPE TIMESTAMPTZ USING due_date::TIMESTAMPTZ;
