-- Migration 069: Real PCAR review queue
-- "Submit for approval" on a self-filed PCAR previously just flipped
-- dms_tasks.status to 'in_progress' with no real reviewer queue behind it —
-- the "QA Lead — pending" panel in the UI was purely decorative. Adds a real
-- 'submitted' status (enforced by the existing task-status logic in
-- TaskService, not a DB constraint, since dms_tasks.status has none today)
-- plus the columns needed to track a QA decision on that submission, and a
-- dedicated correction_text column so "Immediate correction" stops being
-- smashed into description as string concatenation (the literal cause of the
-- "Issue: Issue: Issue: ..." duplication bug).

ALTER TABLE dms_tasks
    ADD COLUMN IF NOT EXISTS correction_text TEXT,
    ADD COLUMN IF NOT EXISTS qa_review_notes TEXT,
    ADD COLUMN IF NOT EXISTS qa_reviewed_by_id UUID REFERENCES dms_users(user_id),
    ADD COLUMN IF NOT EXISTS qa_reviewed_at TIMESTAMPTZ;
