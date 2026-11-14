ALTER TABLE dms_users ADD COLUMN IF NOT EXISTS department VARCHAR(160) NULL;
CREATE INDEX IF NOT EXISTS ix_users_department ON dms_users(department) WHERE department IS NOT NULL;
