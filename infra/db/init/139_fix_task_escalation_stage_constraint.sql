-- Existing installations created dms_task_escalations with the legacy values
-- day_3/day_1, while the application records configurable stages as
-- before_due_N. The failed insert occurred after email delivery, causing
-- later scans to resend the same reminder. This migration aligns the
-- database constraint with the application stage identifiers.
BEGIN;

ALTER TABLE dms_task_escalations
    DROP CONSTRAINT IF EXISTS dms_task_escalations_stage_check;

ALTER TABLE dms_task_escalations
    ADD CONSTRAINT dms_task_escalations_stage_check
    CHECK (stage ~ '^(before_due_[1-9][0-9]{0,2}|day_3|day_1|due|overdue)$');

-- Preserve delivery history from releases that wrote the original stage names.
INSERT INTO dms_task_escalations (task_id, stage, sent_at)
SELECT task_id, 'before_due_' || right(stage, 1), sent_at
FROM dms_task_escalations
WHERE stage IN ('day_3', 'day_1')
ON CONFLICT (task_id, stage) DO NOTHING;

COMMIT;
