CREATE TABLE IF NOT EXISTS dms_evidence_links (
  evidence_link_id UUID PRIMARY KEY,
  evidence_document_id UUID NOT NULL REFERENCES dms_documents(document_id) ON DELETE CASCADE,
  related_document_id UUID NOT NULL REFERENCES dms_documents(document_id) ON DELETE RESTRICT,
  programme_year INTEGER NOT NULL,
  owner_id UUID NOT NULL REFERENCES dms_users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(evidence_document_id, related_document_id, programme_year)
);
CREATE INDEX IF NOT EXISTS ix_evidence_links_programme ON dms_evidence_links(programme_year);
