-- User-supplied version label at upload time (e.g. "v2.1", "Rev A") — distinct from
-- the system's own major/minor version numbering used by the checkout/approval flow.
ALTER TABLE dms_document_versions ADD COLUMN IF NOT EXISTS version_label TEXT;
