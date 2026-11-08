-- Links an archived PCAR to the one live task created from it. The archive
-- remains intact; this marker simply makes promotion safe to repeat.
ALTER TABLE dms_historical_pcars
    ADD COLUMN IF NOT EXISTS migrated_task_id UUID REFERENCES dms_tasks(task_id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS migrated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_historical_pcars_migrated_task
    ON dms_historical_pcars(migrated_task_id)
    WHERE migrated_task_id IS NOT NULL;
