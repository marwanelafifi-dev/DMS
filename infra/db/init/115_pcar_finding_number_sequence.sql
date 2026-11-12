-- Live PCAR numbers share the historical register's numeric sequence. The
-- archive stays immutable; the current register starts immediately after its
-- highest numeric legacy ID and all existing live PCARs are normalised once.
CREATE SEQUENCE IF NOT EXISTS dms_pcar_finding_number_seq START WITH 1;

DO $$
DECLARE
    historical_max BIGINT;
    live_pcar_count BIGINT;
BEGIN
    SELECT COALESCE(MAX(NULLIF(substring(legacy_request_id FROM '([0-9]+)$'), '')::BIGINT), 0)
    INTO historical_max
    FROM dms_historical_pcars;

    SELECT COUNT(*) INTO live_pcar_count
    FROM dms_tasks
    WHERE task_type = 'pcar';

    -- Use short temporary values to prevent a unique-index collision while
    -- normalising already-created PCARs into the continuous register.
    UPDATE dms_tasks
    SET finding_number = 'TMP-' || substring(task_id::text FROM 1 FOR 24)
    WHERE task_type = 'pcar';

    WITH numbered_pcars AS (
        SELECT task_id,
               ROW_NUMBER() OVER (ORDER BY created_at, task_id) AS sequence_number
        FROM dms_tasks
        WHERE task_type = 'pcar'
    )
    UPDATE dms_tasks AS task
    SET finding_number = 'PCAR-' || LPAD((historical_max + numbered_pcars.sequence_number)::text, 6, '0')
    FROM numbered_pcars
    WHERE task.task_id = numbered_pcars.task_id;

    IF historical_max + live_pcar_count = 0 THEN
        -- `setval(..., 0, ...)` is invalid for a sequence that starts at 1.
        PERFORM setval('dms_pcar_finding_number_seq', 1, false);
    ELSE
        PERFORM setval('dms_pcar_finding_number_seq', historical_max + live_pcar_count, true);
    END IF;
END $$;
