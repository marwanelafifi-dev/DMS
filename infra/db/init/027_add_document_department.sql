-- Add department column to dms_documents
-- Allows categorizing documents by department/business unit

ALTER TABLE dms_documents
ADD COLUMN IF NOT EXISTS department VARCHAR(100);

-- Index for filtering by department
CREATE INDEX IF NOT EXISTS idx_documents_department
ON dms_documents(department);
