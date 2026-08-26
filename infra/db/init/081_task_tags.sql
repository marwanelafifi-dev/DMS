-- Reuse the New-DMS array-based Tags model for PCAR / Corrective Action.
ALTER TABLE dms_tasks
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
