CREATE TABLE IF NOT EXISTS dms_task_document_links (
    task_id UUID NOT NULL REFERENCES dms_tasks(task_id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES dms_documents(document_id) ON DELETE CASCADE,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, document_id)
);
CREATE TABLE IF NOT EXISTS dms_task_folder_links (
    task_id UUID NOT NULL REFERENCES dms_tasks(task_id) ON DELETE CASCADE,
    folder_id UUID NOT NULL REFERENCES dms_folders(folder_id) ON DELETE CASCADE,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, folder_id)
);
-- Preserve all existing single-file/folder links in the new relationship model.
INSERT INTO dms_task_document_links (task_id, document_id)
SELECT task_id, document_id FROM dms_tasks WHERE document_id IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO dms_task_folder_links (task_id, folder_id)
SELECT task_id, folder_id FROM dms_tasks WHERE folder_id IS NOT NULL ON CONFLICT DO NOTHING;
