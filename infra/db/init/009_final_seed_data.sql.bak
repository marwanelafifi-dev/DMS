-- =============================================================================
-- FINAL SEED DATA - Simple and Reliable
-- =============================================================================
-- Created: 2026-07-19
-- This script adds test data that works with the actual schema
-- =============================================================================

-- ========== 1. INSERT ADDITIONAL USERS ==========

INSERT INTO dms_users (user_id, full_name, email, is_active, created_at, updated_at)
VALUES
('11111111-1111-1111-1111-111111111111', 'Fatima Mohammed', 'fatima.mohammed@si-ware.com', true, NOW() - INTERVAL '180 days', NOW()),
('22222222-2222-2222-2222-222222222222', 'Mohammed Hassan', 'mohammed.hassan@si-ware.com', true, NOW() - INTERVAL '150 days', NOW()),
('33333333-3333-3333-3333-333333333333', 'Layla Khaled', 'layla.khaled@si-ware.com', true, NOW() - INTERVAL '120 days', NOW()),
('44444444-4444-4444-4444-444444444444', 'Sara Ibrahim', 'sara.ibrahim@si-ware.com', true, NOW() - INTERVAL '90 days', NOW()),
('55555555-5555-5555-5555-555555555555', 'Omar Sultan', 'omar.sultan@si-ware.com', true, NOW() - INTERVAL '60 days', NOW())
ON CONFLICT DO NOTHING;

-- ========== 2. INSERT TASKS ==========

INSERT INTO dms_tasks (task_id, document_id, title, description, task_type, assigned_to_id, manager_id, due_date, status, risk_severity, created_at, updated_at)
VALUES
(gen_random_uuid(), (SELECT document_id FROM dms_documents LIMIT 1), 'Review Quality Documentation', 'Review and approve the quality manual updates', 'correction', '11111111-1111-1111-1111-111111111111'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, (NOW() + INTERVAL '7 days')::date, 'open', 'high', NOW() - INTERVAL '2 days', NOW()),
(gen_random_uuid(), (SELECT document_id FROM dms_documents LIMIT 1 OFFSET 1), 'Complete RCA Analysis', 'Root cause analysis for production issue', 'rca', '22222222-2222-2222-2222-222222222222'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, (NOW() + INTERVAL '3 days')::date, 'open', 'critical', NOW() - INTERVAL '3 days', NOW()),
(gen_random_uuid(), (SELECT document_id FROM dms_documents LIMIT 1 OFFSET 2), 'Update Access Procedures', 'Update documentation with new security requirements', 'correction', '33333333-3333-3333-3333-333333333333'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, (NOW() + INTERVAL '5 days')::date, 'in_progress', 'high', NOW() - INTERVAL '5 days', NOW()),
(gen_random_uuid(), (SELECT document_id FROM dms_documents LIMIT 1 OFFSET 3), 'Conduct Audit', 'Internal audit for compliance verification', 'audit_action', '44444444-4444-4444-4444-444444444444'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, (NOW() + INTERVAL '14 days')::date, 'in_progress', 'medium', NOW() - INTERVAL '7 days', NOW()),
(gen_random_uuid(), (SELECT document_id FROM dms_documents LIMIT 1 OFFSET 4), 'Training Completion', 'Record completion of compliance training', 'audit_action', '55555555-5555-5555-5555-555555555555'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, (NOW() - INTERVAL '5 days')::date, 'done', 'low', NOW() - INTERVAL '15 days', NOW()),
(gen_random_uuid(), (SELECT document_id FROM dms_documents LIMIT 1 OFFSET 5), 'Submit Management Review', 'Complete and submit management review report', 'audit_action', '11111111-1111-1111-1111-111111111111'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, (NOW() - INTERVAL '3 days')::date, 'open', 'critical', NOW() - INTERVAL '20 days', NOW());

-- ========== 3. INSERT REMINDERS ==========

INSERT INTO dms_reminders (reminder_id, task_id, recipient_id, reminder_type, is_sent, due_date, sent_at, created_at)
VALUES
(gen_random_uuid(), (SELECT task_id FROM dms_tasks LIMIT 1), '11111111-1111-1111-1111-111111111111'::uuid, 'APP', false, (NOW() + INTERVAL '7 days')::date, NULL, NOW() - INTERVAL '1 day'),
(gen_random_uuid(), (SELECT task_id FROM dms_tasks LIMIT 1 OFFSET 1), '22222222-2222-2222-2222-222222222222'::uuid, 'APP', false, (NOW() + INTERVAL '3 days')::date, NULL, NOW()),
(gen_random_uuid(), (SELECT task_id FROM dms_tasks LIMIT 1 OFFSET 2), '33333333-3333-3333-3333-333333333333'::uuid, 'APP', true, (NOW() + INTERVAL '5 days')::date, NOW() - INTERVAL '2 days', NOW() - INTERVAL '3 days'),
(gen_random_uuid(), (SELECT task_id FROM dms_tasks LIMIT 1 OFFSET 3), '44444444-4444-4444-4444-444444444444'::uuid, 'APP', true, (NOW() + INTERVAL '14 days')::date, NOW() - INTERVAL '5 days', NOW() - INTERVAL '7 days'),
(gen_random_uuid(), (SELECT task_id FROM dms_tasks LIMIT 1 OFFSET 4), '55555555-5555-5555-5555-555555555555'::uuid, 'APP', true, (NOW() - INTERVAL '5 days')::date, NOW() - INTERVAL '10 days', NOW() - INTERVAL '12 days'),
(gen_random_uuid(), (SELECT task_id FROM dms_tasks LIMIT 1 OFFSET 5), '11111111-1111-1111-1111-111111111111'::uuid, 'APP', true, (NOW() - INTERVAL '3 days')::date, NOW() - INTERVAL '4 days', NOW() - INTERVAL '5 days');

-- ========== 4. INSERT FOLDER PERMISSIONS ==========

INSERT INTO dms_folder_permissions (permission_id, folder_id, user_id, role, granted_at)
VALUES
(gen_random_uuid(), (SELECT folder_id FROM dms_folders LIMIT 1), '11111111-1111-1111-1111-111111111111'::uuid, 'Reader', NOW() - INTERVAL '180 days'),
(gen_random_uuid(), (SELECT folder_id FROM dms_folders LIMIT 1), '22222222-2222-2222-2222-222222222222'::uuid, 'Writer', NOW() - INTERVAL '150 days'),
(gen_random_uuid(), (SELECT folder_id FROM dms_folders LIMIT 1), '33333333-3333-3333-3333-333333333333'::uuid, 'Manager', NOW() - INTERVAL '120 days'),
(gen_random_uuid(), (SELECT folder_id FROM dms_folders LIMIT 1 OFFSET 1), '44444444-4444-4444-4444-444444444444'::uuid, 'Reader', NOW() - INTERVAL '100 days'),
(gen_random_uuid(), (SELECT folder_id FROM dms_folders LIMIT 1 OFFSET 1), '55555555-5555-5555-5555-555555555555'::uuid, 'Writer', NOW() - INTERVAL '90 days');

-- ========== 5. INSERT AUDIT ENTRIES ==========

INSERT INTO dms_audit_trails (log_id, user_id, action, metadata, created_at)
VALUES
(gen_random_uuid(), '11111111-1111-1111-1111-111111111111'::uuid, 'DOCUMENT_DOWNLOADED', '{"action": "download", "timestamp": "' || NOW()::text || '"}'::jsonb, NOW() - INTERVAL '2 days'),
(gen_random_uuid(), '22222222-2222-2222-2222-222222222222'::uuid, 'DOCUMENT_CHECKOUT', '{"action": "checkout", "expiresAt": "' || (NOW() + INTERVAL '1 hour')::text || '"}'::jsonb, NOW() - INTERVAL '1 day'),
(gen_random_uuid(), '33333333-3333-3333-3333-333333333333'::uuid, 'TASK_CREATED', '{"action": "task_created", "status": "open"}'::jsonb, NOW() - INTERVAL '3 days'),
(gen_random_uuid(), '44444444-4444-4444-4444-444444444444'::uuid, 'PERMISSION_GRANTED', '{"action": "permission_granted", "role": "Reader"}'::jsonb, NOW() - INTERVAL '10 days'),
(gen_random_uuid(), '55555555-5555-5555-5555-555555555555'::uuid, 'DOCUMENT_UPLOADED', '{"action": "upload", "fileSize": 245000}'::jsonb, NOW() - INTERVAL '5 days');

-- ========== 6. DISPLAY RESULTS ==========

SELECT 'DATA SEEDING COMPLETE!' as status,
       (SELECT COUNT(*) FROM dms_users) as users,
       (SELECT COUNT(*) FROM dms_documents) as documents,
       (SELECT COUNT(*) FROM dms_tasks) as tasks,
       (SELECT COUNT(*) FROM dms_reminders) as reminders,
       (SELECT COUNT(*) FROM dms_folder_permissions) as permissions,
       (SELECT COUNT(*) FROM dms_audit_trails) as audit_entries;

-- Show sample of new data
\echo '=== SAMPLE TASKS ==='
SELECT task_id::text, title, status, risk_severity, due_date FROM dms_tasks LIMIT 5;

\echo '=== SAMPLE REMINDERS ==='
SELECT reminder_id::text, reminder_type, is_sent, due_date FROM dms_reminders LIMIT 5;

\echo '=== Test data ready for the application! ==='
