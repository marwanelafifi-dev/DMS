-- Adds a description field to documents so uploads can record their purpose/content.
ALTER TABLE dms_documents ADD COLUMN IF NOT EXISTS description TEXT;
