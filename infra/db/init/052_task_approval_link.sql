ALTER TABLE dms_tasks
    ADD COLUMN IF NOT EXISTS approval_id UUID REFERENCES dms_approvals(approval_id) ON DELETE SET NULL;
