CREATE TABLE IF NOT EXISTS dms_audit_cycles (
  audit_cycle_id UUID PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  standard VARCHAR(32) NOT NULL CHECK (standard IN ('ISO 9001:2015','ISO 27001:2022')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','historical','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES dms_users(user_id),
  CHECK (end_date >= start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_audit_cycle_per_standard ON dms_audit_cycles(standard) WHERE status = 'active';
