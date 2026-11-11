CREATE TABLE IF NOT EXISTS dms_task_escalations (
    task_id UUID NOT NULL REFERENCES dms_tasks(task_id) ON DELETE CASCADE,
    stage VARCHAR(16) NOT NULL CHECK (stage IN ('day_3', 'day_1', 'due', 'overdue')),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, stage)
);
