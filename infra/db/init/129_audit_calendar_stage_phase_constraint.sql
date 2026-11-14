-- The original audit calendar allowed only the six legacy external-audit phases.
-- The ISO cycle stage plan also uses preparation, evidence, PCAR, response, and closure stages.
ALTER TABLE dms_audit_calendar_events DROP CONSTRAINT IF EXISTS chk_audit_calendar_phase;
ALTER TABLE dms_audit_calendar_events ADD CONSTRAINT chk_audit_calendar_phase CHECK (phase IN (
  'Internal Audit', 'Stage 1 Audit', 'Stage 2 Audit', 'Surveillance Audit', 'Recertification Audit',
  'Management Review', 'Preparation', 'Evidence Deadline', 'PCAR Closure Deadline',
  'External Finding Response', 'Cycle Closure'
));
