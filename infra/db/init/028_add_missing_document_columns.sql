-- Add missing document columns to match DmsDocument model
-- description, tags, original_document_id

ALTER TABLE dms_documents
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS original_document_id VARCHAR(255);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_documents_department ON dms_documents(department);
CREATE INDEX IF NOT EXISTS idx_documents_category ON dms_documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_status ON dms_documents(status);
