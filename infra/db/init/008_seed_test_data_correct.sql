-- =============================================================================
-- SEED TEST DATA - Corrected for Actual Schema
-- =============================================================================
-- Created: 2026-07-19
-- This script adds realistic test data matching the actual database schema
-- =============================================================================

-- ========== 1. ADD MORE USERS ==========

INSERT INTO dms_users (user_id, full_name, email, is_active, created_at, updated_at)
VALUES
('11111111-1111-1111-1111-111111111111', 'Fatima Mohammed', 'fatima.mohammed@si-ware.com', true, now() - interval '180 days', now()),
('22222222-2222-2222-2222-222222222222', 'Mohammed Hassan', 'mohammed.hassan@si-ware.com', true, now() - interval '150 days', now()),
('33333333-3333-3333-3333-333333333333', 'Layla Khaled', 'layla.khaled@si-ware.com', true, now() - interval '120 days', now()),
('44444444-4444-4444-4444-444444444444', 'Sara Ibrahim', 'sara.ibrahim@si-ware.com', true, now() - interval '90 days', now()),
('55555555-5555-5555-5555-555555555555', 'Omar Sultan', 'omar.sultan@si-ware.com', true, now() - interval '60 days', now())
ON CONFLICT DO NOTHING;

-- ========== 2. CREATE TASKS ==========

INSERT INTO dms_tasks (task_id, document_id, title, description, task_type, assigned_to_id, manager_id, due_date, status, risk_severity, created_at, updated_at)
SELECT
  gen_random_uuid() as task_id,
  d.document_id,
  'Review: ' || d.title as title,
  'Review and approve document updates for compliance',
  CASE WHEN ROW_NUMBER() OVER (ORDER BY random()) % 3 = 0 THEN 'correction'
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 3 = 1 THEN 'rca'
       ELSE 'audit_action' END as task_type,
  CASE WHEN ROW_NUMBER() OVER (ORDER BY random()) % 5 = 0 THEN '11111111-1111-1111-1111-111111111111'::uuid
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 5 = 1 THEN '22222222-2222-2222-2222-222222222222'::uuid
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 5 = 2 THEN '33333333-3333-3333-3333-333333333333'::uuid
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 5 = 3 THEN '44444444-4444-4444-4444-444444444444'::uuid
       ELSE '55555555-5555-5555-5555-555555555555'::uuid END as assigned_to_id,
  '00000000-0000-0000-0000-000000000001'::uuid,
  (now() + (ROW_NUMBER() OVER (ORDER BY random()) % 30)::text || ' days')::date,
  CASE WHEN ROW_NUMBER() OVER (ORDER BY random()) % 3 = 0 THEN 'open'
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 3 = 1 THEN 'in_progress'
       ELSE 'done' END,
  CASE WHEN ROW_NUMBER() OVER (ORDER BY random()) % 4 = 0 THEN 'critical'
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 4 = 1 THEN 'high'
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 4 = 2 THEN 'medium'
       ELSE 'low' END,
  now() - (ROW_NUMBER() OVER (ORDER BY random()) % 10)::text || ' days'::interval,
  now() - (ROW_NUMBER() OVER (ORDER BY random()) % 5)::text || ' days'::interval
FROM dms_documents d
LIMIT 6;

-- ========== 3. CREATE REMINDERS FOR TASKS ==========

INSERT INTO dms_reminders (reminder_id, task_id, recipient_id, reminder_type, is_sent, due_date, sent_at, created_at)
SELECT
  gen_random_uuid() as reminder_id,
  t.task_id,
  t.assigned_to_id,
  'APP' as reminder_type,
  ROW_NUMBER() OVER (ORDER BY random()) % 2 = 0 as is_sent,
  (t.due_date + interval '1 day')::date as due_date,
  CASE WHEN ROW_NUMBER() OVER (ORDER BY random()) % 2 = 0
       THEN now() - (ROW_NUMBER() OVER (ORDER BY random()) % 5)::text || ' days'::interval
       ELSE NULL END,
  now() - (ROW_NUMBER() OVER (ORDER BY random()) % 7)::text || ' days'::interval
FROM dms_tasks t
LIMIT 8;

-- ========== 4. CREATE FOLDER PERMISSIONS ==========

INSERT INTO dms_folder_permissions (permission_id, folder_id, user_id, role, granted_at)
SELECT
  gen_random_uuid() as permission_id,
  f.folder_id,
  CASE WHEN ROW_NUMBER() OVER (ORDER BY random()) % 5 = 0 THEN '11111111-1111-1111-1111-111111111111'::uuid
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 5 = 1 THEN '22222222-2222-2222-2222-222222222222'::uuid
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 5 = 2 THEN '33333333-3333-3333-3333-333333333333'::uuid
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 5 = 3 THEN '44444444-4444-4444-4444-444444444444'::uuid
       ELSE '55555555-5555-5555-5555-555555555555'::uuid END as user_id,
  CASE WHEN ROW_NUMBER() OVER (ORDER BY random()) % 3 = 0 THEN 'Reader'
       WHEN ROW_NUMBER() OVER (ORDER BY random()) % 3 = 1 THEN 'Writer'
       ELSE 'Manager' END as role,
  now() - (ROW_NUMBER() OVER (ORDER BY random()) % 180)::text || ' days'::interval
FROM dms_folders f
LIMIT 10;

-- ========== 5. CREATE AUDIT TRAIL ENTRIES ==========

INSERT INTO dms_audit_trails (log_id, user_id, action, metadata, created_at)
VALUES
(gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'DOCUMENT_DOWNLOADED', '{"documentId":"' || (SELECT document_id FROM dms_documents LIMIT 1)::text || '","timestamp":"' || now()::text || '"}', now() - interval '2 days'),
(gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'DOCUMENT_CHECKOUT', '{"documentId":"' || (SELECT document_id FROM dms_documents LIMIT 1 OFFSET 1)::text || '","expiresAt":"' || (now() + interval '1 hour')::text || '"}', now() - interval '1 day'),
(gen_random_uuid(), '33333333-3333-3333-3333-333333333333', 'TASK_CREATED', '{"taskId":"' || (SELECT task_id FROM dms_tasks LIMIT 1)::text || '","title":"Review Task","status":"open"}', now() - interval '3 days'),
(gen_random_uuid(), '44444444-4444-4444-4444-444444444444', 'PERMISSION_GRANTED', '{"folderId":"' || (SELECT folder_id FROM dms_folders LIMIT 1)::text || '","role":"Reader"}', now() - interval '10 days'),
(gen_random_uuid(), '55555555-5555-5555-5555-555555555555', 'DOCUMENT_UPLOADED', '{"documentId":"' || (SELECT document_id FROM dms_documents LIMIT 1 OFFSET 2)::text || '","fileSize":245000}', now() - interval '5 days');

-- ========== 6. DISPLAY SUMMARY ==========

SELECT
  (SELECT COUNT(*) FROM dms_users) as "Total Users",
  (SELECT COUNT(*) FROM dms_documents) as "Total Documents",
  (SELECT COUNT(*) FROM dms_folders) as "Total Folders",
  (SELECT COUNT(*) FROM dms_tasks) as "Total Tasks",
  (SELECT COUNT(*) FROM dms_reminders) as "Total Reminders",
  (SELECT COUNT(*) FROM dms_folder_permissions) as "Total Permissions",
  (SELECT COUNT(*) FROM dms_audit_trails) as "Total Audit Entries";

-- Show sample data
SELECT 'Tasks' as Data_Type, task_id::text, title, status, risk_severity FROM dms_tasks LIMIT 3;
SELECT 'Reminders' as Data_Type, reminder_id::text, reminder_type, is_sent::text, due_date FROM dms_reminders LIMIT 3;

SELECT 'Test data seeding complete! ✅' as status;
