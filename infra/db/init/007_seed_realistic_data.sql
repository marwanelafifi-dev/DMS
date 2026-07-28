-- =============================================================================
-- REALISTIC TEST DATA SEEDING FOR DMS
-- =============================================================================
-- This script creates realistic test data using documents that exist in the DB
-- Created: 2026-07-19
-- =============================================================================

-- ========== 1. ENSURE WE HAVE ENOUGH USERS ==========

INSERT INTO dms_users (user_id, full_name, email, is_active, created_at, updated_at) VALUES
('10000000-0000-0000-0000-000000000002', 'Fatima Mohammed', 'fatima.mohammed@si-ware.com', true, now() - interval '180 days', now() - interval '180 days'),
('10000000-0000-0000-0000-000000000003', 'Mohammed Hassan', 'mohammed.hassan@si-ware.com', true, now() - interval '150 days', now() - interval '150 days'),
('10000000-0000-0000-0000-000000000004', 'Layla Khaled', 'layla.khaled@si-ware.com', true, now() - interval '120 days', now() - interval '120 days'),
('10000000-0000-0000-0000-000000000005', 'Sara Ibrahim', 'sara.ibrahim@si-ware.com', true, now() - interval '90 days', now() - interval '90 days'),
('10000000-0000-0000-0000-000000000006', 'Omar Sultan', 'omar.sultan@si-ware.com', true, now() - interval '60 days', now() - interval '60 days')
ON CONFLICT (user_id) DO NOTHING;

-- ========== 2. GET EXISTING DOCUMENTS FOR REFERENCE ==========
-- We'll use the documents that were already created via the API

-- ========== 3. CREATE TASKS ==========

-- Get the first few document IDs that exist
WITH existing_docs AS (
  SELECT document_id FROM dms_documents LIMIT 3
)
INSERT INTO dms_tasks (task_id, title, description, task_type, status, priority, assigned_to_id, assigned_by_id, due_date, created_at, updated_at)
SELECT
  'task-' || ROW_NUMBER() OVER (ORDER BY random())::text || '-' || gen_random_uuid()::text as task_id,
  title,
  'Review and approve document updates',
  'correction',
  CASE WHEN ROW_NUMBER() OVER (ORDER BY random()) <= 2 THEN 'open'
       WHEN ROW_NUMBER() OVER (ORDER BY random()) <= 4 THEN 'in_progress'
       ELSE 'done' END,
  CASE WHEN ROW_NUMBER() OVER (ORDER BY random()) % 4 = 0 THEN 'critical'
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 4 = 1 THEN 'high'
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 4 = 2 THEN 'medium'
       ELSE 'low' END,
  '10000000-0000-0000-0000-00000000000' || ((ROW_NUMBER() OVER (ORDER BY random()) % 5) + 2)::text,
  '00000000-0000-0000-0000-000000000001',
  now() + (ROW_NUMBER() OVER (ORDER BY random()) % 30 || ' days')::interval,
  now() - (ROW_NUMBER() OVER (ORDER BY random()) % 10 || ' days')::interval,
  now() - (ROW_NUMBER() OVER (ORDER BY random()) % 5 || ' days')::interval
FROM dms_documents
LIMIT 6;

-- ========== 4. CREATE REMINDERS ==========

INSERT INTO dms_reminders (reminder_id, task_id, recipient_id, reminder_type, is_read, message, due_date, sent_at, created_at)
SELECT
  'reminder-' || ROW_NUMBER() OVER (ORDER BY random())::text || '-' || gen_random_uuid()::text as reminder_id,
  task_id,
  '10000000-0000-0000-0000-00000000000' || ((ROW_NUMBER() OVER (ORDER BY random()) % 5) + 2)::text,
  CASE WHEN ROW_NUMBER() OVER (ORDER BY random()) % 3 = 0 THEN 'task_due'
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 3 = 1 THEN 'task_overdue'
       ELSE 'approval_pending' END,
  ROW_NUMBER() OVER (ORDER BY random()) % 2 = 0,
  'Task reminder: ' || title,
  due_date + interval '1 day',
  now() - (ROW_NUMBER() OVER (ORDER BY random()) % 5 || ' days')::interval,
  now() - (ROW_NUMBER() OVER (ORDER BY random()) % 7 || ' days')::interval
FROM dms_tasks
LIMIT 8;

-- ========== 5. CREATE FOLDER PERMISSIONS ==========

INSERT INTO dms_folder_permissions (permission_id, folder_id, user_id, role, granted_at)
SELECT
  'perm-' || ROW_NUMBER() OVER (ORDER BY random())::text || '-' || gen_random_uuid()::text,
  f.folder_id,
  '10000000-0000-0000-0000-00000000000' || ((ROW_NUMBER() OVER (ORDER BY random()) % 5) + 2)::text,
  CASE WHEN ROW_NUMBER() OVER (ORDER BY random()) % 3 = 0 THEN 'Reader'
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 3 = 1 THEN 'Writer'
       ELSE 'Manager' END,
  now() - (ROW_NUMBER() OVER (ORDER BY random()) % 180 || ' days')::interval
FROM dms_folders f
LIMIT 10;

-- ========== 6. CREATE AUDIT TRAIL ENTRIES ==========

INSERT INTO dms_audit_trails (log_id, user_id, action, metadata, created_at)
SELECT
  'audit-' || ROW_NUMBER() OVER (ORDER BY random())::text || '-' || gen_random_uuid()::text,
  '10000000-0000-0000-0000-00000000000' || ((ROW_NUMBER() OVER (ORDER BY random()) % 6) + 1)::text,
  CASE WHEN ROW_NUMBER() OVER (ORDER BY random()) % 7 = 0 THEN 'DOCUMENT_UPLOADED'
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 7 = 1 THEN 'DOCUMENT_DOWNLOADED'
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 7 = 2 THEN 'DOCUMENT_CHECKOUT'
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 7 = 3 THEN 'DOCUMENT_CHECKIN'
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 7 = 4 THEN 'TASK_CREATED'
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 7 = 5 THEN 'TASK_COMPLETED'
       ELSE 'PERMISSION_GRANTED' END,
  jsonb_build_object(
    'action', 'test_action',
    'timestamp', now()::text,
    'details', 'Seed data entry'
  ),
  now() - (ROW_NUMBER() OVER (ORDER BY random()) % 30 || ' days')::interval
FROM generate_series(1, 15)
LIMIT 15;

-- ========== 7. VERIFY DATA ==========

SELECT
  'Seed Data Summary' as Report,
  (SELECT COUNT(*) FROM dms_users) as Total_Users,
  (SELECT COUNT(*) FROM dms_documents) as Total_Documents,
  (SELECT COUNT(*) FROM dms_tasks) as Total_Tasks,
  (SELECT COUNT(*) FROM dms_reminders) as Total_Reminders,
  (SELECT COUNT(*) FROM dms_folder_permissions) as Total_Permissions,
  (SELECT COUNT(*) FROM dms_audit_trails) as Total_Audit_Entries;

-- Show sample task data
SELECT 'Sample Tasks' as type, task_id, title, status, priority, due_date FROM dms_tasks LIMIT 5;

-- Show sample reminder data
SELECT 'Sample Reminders' as type, reminder_id, message, is_read, due_date FROM dms_reminders LIMIT 5;

SELECT 'Seed data creation complete!' as status;
