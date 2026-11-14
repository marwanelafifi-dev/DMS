-- Optional programme stages can be removed from one audit cycle without
-- deleting their existing event metadata or affecting another cycle.
CREATE TABLE IF NOT EXISTS dms_audit_cycle_stage_exclusions (
    audit_cycle_id UUID NOT NULL REFERENCES dms_audit_cycles(audit_cycle_id) ON DELETE CASCADE,
    stage_key VARCHAR(48) NOT NULL,
    removed_by UUID NOT NULL REFERENCES dms_users(user_id) ON DELETE RESTRICT,
    removed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (audit_cycle_id, stage_key)
);
