-- The original audit register accepted only legacy audit event types.
-- The controlled ISO journey uses four managed stages: Preparation, Internal
-- Audit, Management Review, and Surveillance Audit.  Update existing DMS
-- databases without changing any stored audit records.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'dms_audit_records'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%audit_type%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE dms_audit_records DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE dms_audit_records
  ADD CONSTRAINT chk_audit_records_audit_type
  CHECK (audit_type IN ('preparation', 'internal', 'management_review', 'external', 'supplier', 'follow_up'));
