-- =============================================================================
-- Phase 1: Core DMS Schema
--
-- Full database design for the Enterprise Document Management System v7.4.
-- Runs automatically on Postgres container start (empty data volume only).
--
-- Tables are organized as:
--   1. Identity & access control (users, folders, permissions)
--   2. Document management (documents, versions, metadata)
--   3. Workflows (tasks, workflows, workflow steps)
--   4. Compliance (audit trails, OCR, e-signatures, reminders, retention)
--   5. Indexes for search & performance
--
-- WORM enforced at DB level: audit_trails, dms_ocr_indexes, dms_esignatures,
-- and dms_reminders tables reject UPDATE/DELETE via trigger.
-- =============================================================================

-- --- Identity & Access Control ---

CREATE TABLE IF NOT EXISTS dms_users (
    user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    full_name       VARCHAR(255) NOT NULL,
    sso_subject     VARCHAR(255),  -- Google Workspace / local SSO identifier
    mfa_secret      BYTEA,         -- TOTP secret (encrypted in app layer)
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dms_folders (
    folder_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_folder_id    UUID REFERENCES dms_folders(folder_id) ON DELETE CASCADE,
    name                VARCHAR(255) NOT NULL,
    description         TEXT,
    classification      VARCHAR(50) NOT NULL DEFAULT 'standard',  -- standard, confidential, restricted
    owner_id            UUID NOT NULL REFERENCES dms_users(user_id),
    metadata_schema     JSONB,  -- custom key-value schema for this folder's documents
    retention_policy    VARCHAR(50),  -- Archive, SoftDelete, WormLock
    retention_years     INT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(parent_folder_id, name)
);

CREATE TABLE IF NOT EXISTS dms_folder_permissions (
    permission_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id       UUID NOT NULL REFERENCES dms_folders(folder_id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES dms_users(user_id) ON DELETE CASCADE,
    role            VARCHAR(50) NOT NULL,  -- Reader, Writer, Manager, QA, Admin
    -- Reader: view only
    -- Writer: view + download (no edit) + checkout for edit
    -- Manager: reader + download + edit + approve/reject documents
    -- QA: manager-level + final approval gate + PCAR triage
    -- Admin: all + force-unlock + user management
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    granted_by_id   UUID REFERENCES dms_users(user_id),
    UNIQUE(folder_id, user_id)
);

-- --- Document Management ---

CREATE TABLE IF NOT EXISTS dms_documents (
    document_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id           UUID NOT NULL REFERENCES dms_folders(folder_id),
    title               VARCHAR(255) NOT NULL,
    current_version_id  UUID,  -- foreign key set after dms_document_versions created
    tracking_code       VARCHAR(100) UNIQUE,  -- [DEPT]-[YEAR]-[CATEGORY]-[SEQ], set on release
    status              VARCHAR(50) NOT NULL DEFAULT 'draft',  -- draft, pending_approval, released, archived
    owner_id            UUID NOT NULL REFERENCES dms_users(user_id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dms_document_versions (
    version_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id         UUID NOT NULL REFERENCES dms_documents(document_id) ON DELETE CASCADE,
    version_number      VARCHAR(20) NOT NULL,  -- e.g., 1.0, 1.1, 1.2, 2.0
    file_name           VARCHAR(255) NOT NULL,
    file_size_bytes     BIGINT,
    mime_type           VARCHAR(100),
    s3_object_key       VARCHAR(500) NOT NULL UNIQUE,  -- path in MinIO
    sha256_hash         VARCHAR(64) NOT NULL,  -- binary file integrity
    status              VARCHAR(50) NOT NULL DEFAULT 'draft',  -- draft, pending_qa, pending_manager, released, archived
    -- Checkout lock fields (Phase 2 vault access control)
    is_checked_out      BOOLEAN NOT NULL DEFAULT FALSE,
    checked_out_by      UUID REFERENCES dms_users(user_id),
    checked_out_at      TIMESTAMPTZ,
    checkout_reason     TEXT,
    -- Approval workflow fields
    submitted_by_id     UUID REFERENCES dms_users(user_id),
    submitted_at        TIMESTAMPTZ,
    approved_by_id      UUID REFERENCES dms_users(user_id),
    approved_at         TIMESTAMPTZ,
    approval_comment    TEXT,
    -- Version tracking
    major_version       INT NOT NULL DEFAULT 1,
    minor_version       INT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(document_id, version_number)
);

ALTER TABLE dms_documents ADD CONSTRAINT fk_documents_current_version
    FOREIGN KEY (current_version_id) REFERENCES dms_document_versions(version_id);

CREATE TABLE IF NOT EXISTS dms_document_metadata (
    metadata_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id      UUID NOT NULL REFERENCES dms_document_versions(version_id) ON DELETE CASCADE,
    custom_data     JSONB NOT NULL,  -- folder-scoped custom key-value pairs
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Workflows (C-Doc & PCAR) ---

CREATE TABLE IF NOT EXISTS dms_workflow_templates (
    template_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id       UUID REFERENCES dms_folders(folder_id) ON DELETE SET NULL,
    name            VARCHAR(100) NOT NULL,  -- 'C-Doc', 'PCAR'
    description     TEXT,
    steps           JSONB NOT NULL,  -- ordered array of step definitions
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dms_workflows (
    workflow_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id         UUID REFERENCES dms_documents(document_id) ON DELETE SET NULL,
    task_id             UUID,  -- for PCAR workflows
    template_id         UUID NOT NULL REFERENCES dms_workflow_templates(template_id),
    current_step_index  INT NOT NULL DEFAULT 0,
    status              VARCHAR(50) NOT NULL DEFAULT 'active',  -- active, completed, rejected
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dms_workflow_steps (
    step_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id     UUID NOT NULL REFERENCES dms_workflows(workflow_id) ON DELETE CASCADE,
    step_index      INT NOT NULL,
    step_type       VARCHAR(50) NOT NULL,  -- qa_pre_check, manager_approval, qa_release, pcar_triage, rca_entry, manager_review
    assigned_to_id  UUID REFERENCES dms_users(user_id),
    status          VARCHAR(50) NOT NULL DEFAULT 'pending',  -- pending, in_progress, completed, skipped
    comment         TEXT,
    completed_by_id UUID REFERENCES dms_users(user_id),
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Tasks (native tasks module for audit actions & PCAR RCA tracking) ---

CREATE TABLE IF NOT EXISTS dms_tasks (
    task_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_step_id UUID REFERENCES dms_workflow_steps(step_id) ON DELETE SET NULL,
    document_id     UUID REFERENCES dms_documents(document_id) ON DELETE SET NULL,
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    task_type       VARCHAR(50) NOT NULL,  -- correction, rca, audit_action
    assigned_to_id  UUID NOT NULL REFERENCES dms_users(user_id),
    manager_id      UUID REFERENCES dms_users(user_id),  -- for Track B PCAR
    risk_severity   VARCHAR(50),  -- Minor, Major, Critical (PCAR)
    due_date        DATE,
    status          VARCHAR(50) NOT NULL DEFAULT 'open',  -- open, in_progress, completed, overdue
    rca_text        TEXT,  -- mandatory for PCAR tasks
    preventive_actions TEXT,  -- mandatory for PCAR tasks
    evidence_url    VARCHAR(500),  -- link to document/attachment proof
    completed_by_id UUID REFERENCES dms_users(user_id),
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Compliance & Audit ---

-- dms_audit_trails is defined in 001_worm_roles.sql (WORM protected)

CREATE TABLE IF NOT EXISTS dms_ocr_indexes (
    ocr_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id      UUID NOT NULL REFERENCES dms_document_versions(version_id) ON DELETE CASCADE,
    extracted_text  TEXT NOT NULL,
    page_count      INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dms_esignatures (
    signature_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id      UUID NOT NULL REFERENCES dms_document_versions(version_id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES dms_users(user_id),
    signature_hash  VARCHAR(256) NOT NULL,
    -- Signature metadata for the stamp overlay
    signature_meta  JSONB,  -- { "full_name": "...", "email": "...", "timestamp": "..." }
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dms_reminders (
    reminder_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         UUID NOT NULL REFERENCES dms_tasks(task_id) ON DELETE CASCADE,
    recipient_id    UUID NOT NULL REFERENCES dms_users(user_id),
    reminder_type   VARCHAR(20) NOT NULL CHECK (reminder_type IN ('APP', 'EMAIL', 'BOTH')),
    due_date        DATE NOT NULL,
    is_sent         BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Retention & Lifecycle ---

CREATE TABLE IF NOT EXISTS dms_retention_policies (
    policy_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id       UUID REFERENCES dms_folders(folder_id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    classification  VARCHAR(50),  -- if set, applies to docs with this tag
    action          VARCHAR(50) NOT NULL,  -- Archive, SoftDelete, WormLock
    retain_years    INT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --- Indexes for performance & full-text search ---

CREATE INDEX idx_dms_users_email ON dms_users(email);
CREATE INDEX idx_dms_users_sso_subject ON dms_users(sso_subject);

CREATE INDEX idx_dms_folders_parent ON dms_folders(parent_folder_id);
CREATE INDEX idx_dms_folders_owner ON dms_folders(owner_id);

CREATE INDEX idx_dms_folder_permissions_folder ON dms_folder_permissions(folder_id);
CREATE INDEX idx_dms_folder_permissions_user ON dms_folder_permissions(user_id);

CREATE INDEX idx_dms_documents_folder ON dms_documents(folder_id);
CREATE INDEX idx_dms_documents_owner ON dms_documents(owner_id);
CREATE INDEX idx_dms_documents_status ON dms_documents(status);
CREATE INDEX idx_dms_documents_tracking_code ON dms_documents(tracking_code);

CREATE INDEX idx_dms_document_versions_document ON dms_document_versions(document_id);
CREATE INDEX idx_dms_document_versions_status ON dms_document_versions(status);
CREATE INDEX idx_dms_document_versions_checkout ON dms_document_versions(is_checked_out, checked_out_by);
CREATE INDEX idx_dms_document_versions_s3_key ON dms_document_versions(s3_object_key);

-- Full-text search index on OCR extracted text
CREATE INDEX idx_dms_ocr_extracted_text ON dms_ocr_indexes USING gin(to_tsvector('english', extracted_text));

CREATE INDEX idx_dms_document_metadata_version ON dms_document_metadata(version_id);

CREATE INDEX idx_dms_tasks_assigned_to ON dms_tasks(assigned_to_id);
CREATE INDEX idx_dms_tasks_status ON dms_tasks(status);
CREATE INDEX idx_dms_tasks_due_date ON dms_tasks(due_date);
CREATE INDEX idx_dms_tasks_document ON dms_tasks(document_id);

CREATE INDEX idx_dms_workflows_document ON dms_workflows(document_id);
CREATE INDEX idx_dms_workflows_status ON dms_workflows(status);

CREATE INDEX idx_dms_reminders_recipient ON dms_reminders(recipient_id);
CREATE INDEX idx_dms_reminders_due_date ON dms_reminders(due_date);
CREATE INDEX idx_dms_reminders_is_sent ON dms_reminders(is_sent);

-- Audit trail index (log_id is PK, but add created_at for time-range queries)
CREATE INDEX idx_dms_audit_trails_user ON dms_audit_trails(user_id);
CREATE INDEX idx_dms_audit_trails_action ON dms_audit_trails(action);
CREATE INDEX idx_dms_audit_trails_created_at ON dms_audit_trails(created_at);

-- --- WORM Enforcement (add-on tables: reject mutations) ---

CREATE OR REPLACE FUNCTION dms_reject_mutation_ocr() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'WORM violation: % on % is not permitted', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_worm_ocr_indexes ON dms_ocr_indexes;
CREATE TRIGGER trg_worm_ocr_indexes
    BEFORE UPDATE OR DELETE ON dms_ocr_indexes
    FOR EACH ROW EXECUTE FUNCTION dms_reject_mutation_ocr();

CREATE OR REPLACE FUNCTION dms_reject_mutation_esig() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'WORM violation: % on % is not permitted', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_worm_esignatures ON dms_esignatures;
CREATE TRIGGER trg_worm_esignatures
    BEFORE UPDATE OR DELETE ON dms_esignatures
    FOR EACH ROW EXECUTE FUNCTION dms_reject_mutation_esig();

CREATE OR REPLACE FUNCTION dms_reject_mutation_reminders() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'WORM violation: % on % is not permitted', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_worm_reminders ON dms_reminders;
CREATE TRIGGER trg_worm_reminders
    BEFORE UPDATE OR DELETE ON dms_reminders
    FOR EACH ROW EXECUTE FUNCTION dms_reject_mutation_reminders();
