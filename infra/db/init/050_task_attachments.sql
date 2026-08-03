-- File attachments on tasks (e.g. supporting evidence for a PCAR / Corrective
-- Action task) — the "Create New Task" form previously had no way to attach
-- anything at all.
CREATE TABLE IF NOT EXISTS dms_task_attachments (
    attachment_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         UUID NOT NULL REFERENCES dms_tasks(task_id) ON DELETE CASCADE,
    file_name       TEXT NOT NULL,
    file_size_bytes BIGINT,
    mime_type       TEXT,
    s3_object_key   TEXT NOT NULL,
    uploaded_by     UUID NOT NULL REFERENCES dms_users(user_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_attachments_task_id ON dms_task_attachments(task_id);
