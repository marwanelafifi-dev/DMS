-- Verification is intentionally independent of PCAR creation. This keeps
-- finding initiation and effectiveness approval as separate compliance roles.
ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_verify_pcars BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE dms_page_access_roles
SET can_verify_pcars = TRUE
WHERE role IN ('Quality', 'Auditor', 'Full Access');

-- Captures the verifier's explicit effectiveness decision at closure/return.
ALTER TABLE dms_tasks
    ADD COLUMN IF NOT EXISTS effectiveness_result VARCHAR(16);

ALTER TABLE dms_tasks DROP CONSTRAINT IF EXISTS dms_tasks_effectiveness_result_check;
ALTER TABLE dms_tasks ADD CONSTRAINT dms_tasks_effectiveness_result_check
    CHECK (effectiveness_result IS NULL OR effectiveness_result IN ('effective', 'ineffective'));
