-- Migration 090: enforce one live approval workflow per document.
--
-- Earlier submit-batch behavior allowed the same document to be submitted
-- repeatedly. Uploading a new version then re-pointed every non-approved row,
-- making identical entries appear in QA/Manager Review. Preserve the newest
-- live row and retire older duplicates before adding the concurrency-safe
-- database invariant.

-- A previously duplicated workflow could leave one pending row behind after
-- another duplicate released/rejected the shared document. The queue hid that
-- row through the document-status guard, but it remained active internally and
-- could block or reappear during a later revision. Retire it explicitly first.
UPDATE dms_approval_documents ad
SET status = 'superseded',
    current_stage = 'superseded',
    updated_at = now(),
    release_notes = CASE
        WHEN NULLIF(BTRIM(ad.release_notes), '') IS NULL
            THEN 'Automatically retired stale workflow for a terminal document during migration 090.'
        ELSE ad.release_notes || E'\nAutomatically retired stale workflow for a terminal document during migration 090.'
    END
FROM dms_documents document
WHERE ad.document_id = document.document_id
  AND ad.status IN ('pending', 'correction_requested')
  AND document.status IN ('released', 'rejected');

WITH ranked_active AS (
    SELECT ad.approval_document_id,
           ROW_NUMBER() OVER (
               PARTITION BY ad.document_id
               ORDER BY
                   EXISTS (
                       SELECT 1
                       FROM dms_tasks task
                       WHERE task.approval_id = ad.approval_id
                         AND task.document_id = ad.document_id
                         AND task.status <> 'completed'
                   ) DESC,
                   CASE WHEN ad.status = 'correction_requested' THEN 0 ELSE 1 END,
                   ad.updated_at DESC,
                   ad.created_at DESC,
                   ad.approval_document_id DESC
           ) AS active_rank
    FROM dms_approval_documents ad
    WHERE ad.status IN ('pending', 'correction_requested')
)
UPDATE dms_approval_documents ad
SET status = 'superseded',
    current_stage = 'superseded',
    updated_at = now(),
    release_notes = CASE
        WHEN NULLIF(BTRIM(ad.release_notes), '') IS NULL
            THEN 'Automatically retired duplicate approval workflow during migration 090.'
        ELSE ad.release_notes || E'\nAutomatically retired duplicate approval workflow during migration 090.'
    END
FROM ranked_active ranked
WHERE ad.approval_document_id = ranked.approval_document_id
  AND ranked.active_rank > 1;

-- If an accidental approval batch contained only rows retired above, retire
-- its summary row too. Mixed batches retain their aggregate state because
-- their other documents may still be legitimately active or completed.
UPDATE dms_approvals approval
SET status = 'superseded',
    current_stage = 'superseded'
WHERE EXISTS (
        SELECT 1 FROM dms_approval_documents ad
        WHERE ad.approval_id = approval.approval_id
    )
  AND NOT EXISTS (
        SELECT 1 FROM dms_approval_documents ad
        WHERE ad.approval_id = approval.approval_id
          AND ad.status <> 'superseded'
    );

CREATE UNIQUE INDEX IF NOT EXISTS ux_dms_approval_documents_one_active_per_document
    ON dms_approval_documents(document_id)
    WHERE status IN ('pending', 'correction_requested');
