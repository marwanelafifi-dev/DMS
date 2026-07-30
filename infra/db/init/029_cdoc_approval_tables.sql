-- C-Doc approval batches and their submitted document versions.
--
-- This file is safe to run against both a fresh database and an existing
-- persistent volume. PostgreSQL's Docker entrypoint only runs init scripts for
-- an empty volume, so upgrades must also apply this file explicitly.

CREATE TABLE IF NOT EXISTS dms_approvals (
    approval_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by       UUID NOT NULL REFERENCES dms_users(user_id) ON DELETE RESTRICT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_stage    VARCHAR(50) NOT NULL DEFAULT 'qa_review',
    status           VARCHAR(50) NOT NULL DEFAULT 'pending',
    qa_notes         TEXT,
    manager_notes    TEXT,
    tracking_code    VARCHAR(100),
    release_notes    TEXT
);

CREATE TABLE IF NOT EXISTS dms_approval_documents (
    approval_document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_id          UUID NOT NULL REFERENCES dms_approvals(approval_id) ON DELETE CASCADE,
    document_id          UUID NOT NULL REFERENCES dms_documents(document_id) ON DELETE CASCADE,
    version_id           UUID NOT NULL REFERENCES dms_document_versions(version_id) ON DELETE CASCADE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (approval_id, document_id, version_id)
);

CREATE INDEX IF NOT EXISTS idx_dms_approvals_queue
    ON dms_approvals(current_stage, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dms_approvals_created_by
    ON dms_approvals(created_by);

CREATE INDEX IF NOT EXISTS idx_dms_approval_documents_approval
    ON dms_approval_documents(approval_id);

CREATE INDEX IF NOT EXISTS idx_dms_approval_documents_document
    ON dms_approval_documents(document_id);

CREATE INDEX IF NOT EXISTS idx_dms_approval_documents_version
    ON dms_approval_documents(version_id);
