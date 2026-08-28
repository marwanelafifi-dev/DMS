-- Atomic monthly Document ID sequences.
-- Format: SWS-YYMM#### (for example, SWS-26080001).

CREATE TABLE IF NOT EXISTS dms_document_id_sequences (
    period_key TEXT PRIMARY KEY,
    last_value INTEGER NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_dms_document_id_sequences_period
        CHECK (period_key ~ '^[0-9]{4}$'),
    CONSTRAINT ck_dms_document_id_sequences_value
        CHECK (last_value >= 0)
);

-- Seed or advance each period from IDs that already exist. This makes the
-- migration safe for a populated system and prevents reusing an existing ID.
INSERT INTO dms_document_id_sequences (period_key, last_value, updated_at)
SELECT
    SUBSTRING(original_document_id FROM 5 FOR 4),
    MAX(RIGHT(original_document_id, 4)::INTEGER),
    now()
FROM dms_documents
WHERE original_document_id ~* '^SWS-[0-9]{8}$'
GROUP BY SUBSTRING(original_document_id FROM 5 FOR 4)
ON CONFLICT (period_key) DO UPDATE
SET last_value = GREATEST(
        dms_document_id_sequences.last_value,
        EXCLUDED.last_value
    ),
    updated_at = now();

COMMENT ON TABLE dms_document_id_sequences IS
    'Atomic monthly counters for system-generated SWS-YYMM#### Document IDs.';
