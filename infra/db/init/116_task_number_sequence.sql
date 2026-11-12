-- Normal internal Tasks have their own register sequence. It intentionally
-- starts at 1 and is independent from the historical/live PCAR sequence.
ALTER TABLE dms_tasks ADD COLUMN IF NOT EXISTS task_number VARCHAR(32);
CREATE SEQUENCE IF NOT EXISTS dms_task_number_seq START WITH 1;

DO $$
DECLARE
    normal_task_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO normal_task_count
    FROM dms_tasks
    WHERE task_type <> 'pcar';

    WITH numbered_tasks AS (
        SELECT task_id,
               ROW_NUMBER() OVER (ORDER BY created_at, task_id) AS sequence_number
        FROM dms_tasks
        WHERE task_type <> 'pcar'
    )
    UPDATE dms_tasks AS task
    SET task_number = 'TASK-' || LPAD(numbered_tasks.sequence_number::text, 6, '0')
    FROM numbered_tasks
    WHERE task.task_id = numbered_tasks.task_id;

    IF normal_task_count = 0 THEN
        PERFORM setval('dms_task_number_seq', 1, false);
    ELSE
        PERFORM setval('dms_task_number_seq', normal_task_count, true);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_task_number
    ON dms_tasks(task_number)
    WHERE task_number IS NOT NULL;

CREATE OR REPLACE FUNCTION dms_assign_task_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF COALESCE(NEW.task_type, 'task') <> 'pcar' AND NEW.task_number IS NULL THEN
        NEW.task_number := 'TASK-' || LPAD(nextval('dms_task_number_seq')::text, 6, '0');
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dms_assign_task_number ON dms_tasks;
CREATE TRIGGER trg_dms_assign_task_number
    BEFORE INSERT ON dms_tasks
    FOR EACH ROW
    EXECUTE FUNCTION dms_assign_task_number();
