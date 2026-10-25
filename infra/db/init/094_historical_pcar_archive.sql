-- Immutable archive for historical PCAR exports. It is separate from live
-- dms_tasks so closed legacy work cannot enter current users' action queues.
CREATE TABLE IF NOT EXISTS dms_historical_pcars (
    historical_pcar_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_system VARCHAR(50) NOT NULL DEFAULT 'manageengine',
    legacy_request_id VARCHAR(100) NOT NULL,
    group_name VARCHAR(255),
    requester_name VARCHAR(255),
    department VARCHAR(255),
    category VARCHAR(100),
    subject TEXT,
    description TEXT,
    historical_owner_name VARCHAR(255),
    linked_user_id UUID REFERENCES dms_users(user_id) ON DELETE SET NULL,
    priority VARCHAR(100),
    severity VARCHAR(100),
    source_status VARCHAR(100),
    resolution TEXT,
    closure_code TEXT,
    closure_comments TEXT,
    source_created_at TIMESTAMPTZ,
    source_due_at TIMESTAMPTZ,
    source_completed_at TIMESTAMPTZ,
    source_updated_at TIMESTAMPTZ,
    imported_by_id UUID NOT NULL REFERENCES dms_users(user_id) ON DELETE RESTRICT,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_historical_pcar_source_request UNIQUE (source_system, legacy_request_id)
);

CREATE INDEX IF NOT EXISTS idx_historical_pcars_owner ON dms_historical_pcars(historical_owner_name);
CREATE INDEX IF NOT EXISTS idx_historical_pcars_status ON dms_historical_pcars(source_status);
CREATE INDEX IF NOT EXISTS idx_historical_pcars_created ON dms_historical_pcars(source_created_at DESC);
