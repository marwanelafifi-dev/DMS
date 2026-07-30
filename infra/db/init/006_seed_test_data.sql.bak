-- =============================================================================
-- SEED TEST DATA FOR DMS v7.4
-- =============================================================================
-- This migration creates realistic test data for development and testing.
-- Includes: Users, Folders, Documents, Tasks, Reminders, Permissions, Approvals
--
-- Created: 2026-07-19
-- Status: Initial seed data for Phase 2+ testing
-- =============================================================================

-- ========== 1. SEED USERS ==========

INSERT INTO dms_users (user_id, full_name, email, is_active, created_at, updated_at) VALUES
-- Admin users
('00000000-0000-0000-0000-000000000001', 'System Admin', 'admin@si-ware.com', true, now(), now()),
('10000000-0000-0000-0000-000000000001', 'Ahmed Ali', 'ahmed.ali@si-ware.com', true, now(), now()),

-- QA Manager
('20000000-0000-0000-0000-000000000001', 'Fatima Mohamed', 'fatima.mohamed@si-ware.com', true, now(), now()),

-- Writers (Document Creators)
('30000000-0000-0000-0000-000000000001', 'Mohammed Hassan', 'mohammed.hassan@si-ware.com', true, now(), now()),
('30000000-0000-0000-0000-000000000002', 'Layla Khaled', 'layla.khaled@si-ware.com', true, now(), now()),

-- Readers (Viewers)
('40000000-0000-0000-0000-000000000001', 'Sara Ibrahim', 'sara.ibrahim@si-ware.com', true, now(), now()),
('40000000-0000-0000-0000-000000000002', 'Omar Sultan', 'omar.sultan@si-ware.com', true, now(), now())
ON CONFLICT DO NOTHING;

-- ========== 2. SEED FOLDERS ==========

INSERT INTO dms_folders (folder_id, name, description, owner_id, classification, created_at, updated_at) VALUES
-- Root QMS folder
('a0000000-0000-0000-0000-000000000001', 'Quality Management System', 'ISO 9001:2015 compliance documents', '10000000-0000-0000-0000-000000000001', 'standard', now(), now()),

-- Root ISMS folder
('b0000000-0000-0000-0000-000000000001', 'Information Security Management', 'ISO 27001:2022 compliance documents', '10000000-0000-0000-0000-000000000001', 'standard', now(), now()),

-- QMS subfolders
('a1000000-0000-0000-0000-000000000001', 'Management Documents', 'Core management documentation', '10000000-0000-0000-0000-000000000001', 'standard', now(), now()),
('a2000000-0000-0000-0000-000000000001', 'Work Instructions', 'Detailed work instructions and procedures', '10000000-0000-0000-0000-000000000001', 'standard', now(), now()),
('a3000000-0000-0000-0000-000000000001', 'Forms & Templates', 'Standard forms and templates', '10000000-0000-0000-0000-000000000001', 'standard', now(), now()),
('a4000000-0000-0000-0000-000000000001', 'Training Materials', 'Employee training and onboarding materials', '10000000-0000-0000-0000-000000000001', 'standard', now(), now()),

-- ISMS subfolders
('b1000000-0000-0000-0000-000000000001', 'Policies', 'Information security policies', '10000000-0000-0000-0000-000000000001', 'standard', now(), now()),
('b2000000-0000-0000-0000-000000000001', 'Access Control', 'Access control and authentication docs', '10000000-0000-0000-0000-000000000001', 'standard', now(), now()),
('b3000000-0000-0000-0000-000000000001', 'Incidents & Compliance', 'Security incident and audit reports', '10000000-0000-0000-0000-000000000001', 'restricted', now(), now())
ON CONFLICT DO NOTHING;

-- Update folder hierarchy (parent_folder_id)
UPDATE dms_folders SET parent_folder_id = 'a0000000-0000-0000-0000-000000000001' WHERE folder_id IN ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001');
UPDATE dms_folders SET parent_folder_id = 'b0000000-0000-0000-0000-000000000001' WHERE folder_id IN ('b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001');

-- ========== 3. SEED DOCUMENTS ==========

INSERT INTO dms_documents (document_id, folder_id, title, owner_id, status, tracking_code, created_at, updated_at) VALUES
-- QMS Management Documents (Draft)
('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Quality Management Policy v2.1', '30000000-0000-0000-0000-000000000001', 'draft', 'QMS-POL-001', now(), now()),
('c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Management Review Procedure', '30000000-0000-0000-0000-000000000001', 'draft', 'QMS-PRO-001', now(), now()),

-- QMS Management Documents (Pending Approval)
('c1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'Document Control Procedure', '30000000-0000-0000-0000-000000000001', 'pending_approval', 'QMS-PRO-002', now(), now()),
('c1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'Internal Audit Checklist', '30000000-0000-0000-0000-000000000002', 'pending_approval', 'QMS-CHK-001', now(), now()),

-- QMS Management Documents (Released)
('c1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', 'Quality Manual v3.0', '30000000-0000-0000-0000-000000000001', 'released', 'QMS-MAN-001', now() - interval '30 days', now() - interval '30 days'),
('c1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000001', 'Customer Complaint Procedure', '30000000-0000-0000-0000-000000000002', 'released', 'QMS-PRO-003', now() - interval '60 days', now() - interval '60 days'),

-- Work Instructions (Released)
('c2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'Production Process WI-001', '30000000-0000-0000-0000-000000000001', 'released', 'QMS-WI-001', now() - interval '45 days', now() - interval '45 days'),
('c2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'Quality Inspection Procedure WI-002', '30000000-0000-0000-0000-000000000001', 'released', 'QMS-WI-002', now() - interval '20 days', now() - interval '20 days'),
('c2000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'Non-Conformance Handling WI-003', '30000000-0000-0000-0000-000000000002', 'pending_approval', 'QMS-WI-003', now(), now()),

-- Forms & Templates (Released)
('c3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'Document Change Request Form', '30000000-0000-0000-0000-000000000001', 'released', 'QMS-FRM-001', now() - interval '90 days', now() - interval '90 days'),
('c3000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', 'Corrective Action Request Template', '30000000-0000-0000-0000-000000000002', 'released', 'QMS-FRM-002', now() - interval '75 days', now() - interval '75 days'),

-- Training Materials (Draft)
('c4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'ISO 9001:2015 Standards Overview', '30000000-0000-0000-0000-000000000001', 'draft', 'TRN-001', now(), now()),
('c4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000001', 'New Employee Onboarding Checklist', '30000000-0000-0000-0000-000000000002', 'released', 'TRN-002', now() - interval '15 days', now() - interval '15 days'),

-- ISMS Policies (Released)
('d1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Information Security Policy', '20000000-0000-0000-0000-000000000001', 'released', 'ISMS-POL-001', now() - interval '120 days', now() - interval '120 days'),
('d1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'Data Protection & Privacy Policy', '20000000-0000-0000-0000-000000000001', 'released', 'ISMS-POL-002', now() - interval '100 days', now() - interval '100 days'),
('d1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001', 'Password Management Policy v2', '20000000-0000-0000-0000-000000000001', 'pending_approval', 'ISMS-POL-003', now(), now()),

-- Access Control (Released)
('d2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'User Access Control Procedure', '20000000-0000-0000-0000-000000000001', 'released', 'ISMS-ACC-001', now() - interval '80 days', now() - interval '80 days'),

-- Incidents & Compliance (Restricted)
('d3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 'Security Incident Report 2026-07-15', '20000000-0000-0000-0000-000000000001', 'released', 'ISMS-INC-001', now() - interval '4 days', now() - interval '4 days'),
('d3000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-000000000001', 'ISO 27001 Audit Report H1 2026', '20000000-0000-0000-0000-000000000001', 'released', 'ISMS-AUD-001', now() - interval '10 days', now() - interval '10 days')
ON CONFLICT DO NOTHING;

-- ========== 4. SEED DOCUMENT VERSIONS ==========

INSERT INTO dms_document_versions (version_id, document_id, version_number, uploaded_by, uploaded_at, change_notes, file_size, s3_object_key) VALUES
-- Latest versions for each document
('v1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 1, '30000000-0000-0000-0000-000000000001', now(), 'Initial draft', 245000, 'qms/doc-001-v1.pdf'),
('v1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 1, '30000000-0000-0000-0000-000000000001', now(), 'Initial draft', 156000, 'qms/doc-002-v1.pdf'),
('v1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000003', 1, '30000000-0000-0000-0000-000000000001', now(), 'Ready for review', 312000, 'qms/doc-003-v1.pdf'),
('v1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000004', 1, '30000000-0000-0000-0000-000000000002', now(), 'Initial draft', 89000, 'qms/doc-004-v1.pdf'),
('v1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000005', 3, '30000000-0000-0000-0000-000000000001', now() - interval '30 days', 'v3.0 - Updated process flows', 523000, 'qms/doc-005-v3.pdf'),
('v1000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-000000000006', 2, '30000000-0000-0000-0000-000000000002', now() - interval '60 days', 'v2 - Added SLA metrics', 267000, 'qms/doc-006-v2.pdf'),
('v2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 2, '30000000-0000-0000-0000-000000000001', now() - interval '45 days', 'v2 - Updated equipment list', 445000, 'qms/doc-007-v2.pdf'),
('v2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000001', 1, '30000000-0000-0000-0000-000000000001', now() - interval '20 days', 'Initial release', 189000, 'qms/doc-008-v1.pdf'),
('v2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000002', 1, '30000000-0000-0000-0000-000000000002', now(), 'Ready for approval', 234000, 'qms/doc-009-v1.pdf'),
('v3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 1, '30000000-0000-0000-0000-000000000001', now() - interval '90 days', 'Standard form v1', 112000, 'qms/doc-010-v1.pdf'),
('v3000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000001', 1, '30000000-0000-0000-0000-000000000002', now() - interval '75 days', 'Template design', 167000, 'qms/doc-011-v1.pdf'),
('v4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001', 1, '30000000-0000-0000-0000-000000000001', now(), 'Training material draft', 1245000, 'training/doc-001-v1.pdf'),
('v4000000-0000-0000-0000-000000000002', 'c4000000-0000-0000-0000-000000000001', 1, '30000000-0000-0000-0000-000000000002', now() - interval '15 days', 'Onboarding checklist', 89000, 'training/doc-002-v1.pdf'),
('vd000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 3, '20000000-0000-0000-0000-000000000001', now() - interval '120 days', 'v3.0 - Enhanced threat assessment', 456000, 'isms/doc-001-v3.pdf'),
('vd000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', 2, '20000000-0000-0000-0000-000000000001', now() - interval '100 days', 'v2 - GDPR alignment', 523000, 'isms/doc-002-v2.pdf'),
('vd000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000001', 2, '20000000-0000-0000-0000-000000000001', now(), 'v2 - Under review', 301000, 'isms/doc-003-v2.pdf'),
('vd000000-0000-0000-0000-000000000004', 'd2000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000001', now() - interval '80 days', 'Initial release', 234000, 'isms/doc-004-v1.pdf'),
('vd000000-0000-0000-0000-000000000005', 'd3000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000001', now() - interval '4 days', 'Incident documented', 145000, 'isms/doc-005-v1.pdf'),
('vd000000-0000-0000-0000-000000000006', 'd3000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000001', now() - interval '10 days', 'Audit completed', 567000, 'isms/doc-006-v1.pdf')
ON CONFLICT DO NOTHING;

-- Update current_version_id for documents
UPDATE dms_documents SET current_version_id = 'v1000000-0000-0000-0000-000000000001' WHERE document_id = 'c1000000-0000-0000-0000-000000000001';
UPDATE dms_documents SET current_version_id = 'v1000000-0000-0000-0000-000000000002' WHERE document_id = 'c1000000-0000-0000-0000-000000000002';
UPDATE dms_documents SET current_version_id = 'v1000000-0000-0000-0000-000000000003' WHERE document_id = 'c1000000-0000-0000-0000-000000000003';
UPDATE dms_documents SET current_version_id = 'v1000000-0000-0000-0000-000000000004' WHERE document_id = 'c1000000-0000-0000-0000-000000000004';
UPDATE dms_documents SET current_version_id = 'v1000000-0000-0000-0000-000000000005' WHERE document_id = 'c1000000-0000-0000-0000-000000000005';
UPDATE dms_documents SET current_version_id = 'v1000000-0000-0000-0000-000000000006' WHERE document_id = 'c1000000-0000-0000-0000-000000000006';
UPDATE dms_documents SET current_version_id = 'v2000000-0000-0000-0000-000000000001' WHERE document_id = 'c2000000-0000-0000-0000-000000000001';
UPDATE dms_documents SET current_version_id = 'v2000000-0000-0000-0000-000000000002' WHERE document_id = 'c2000000-0000-0000-0000-000000000002';
UPDATE dms_documents SET current_version_id = 'v2000000-0000-0000-0000-000000000003' WHERE document_id = 'c2000000-0000-0000-0000-000000000003';
UPDATE dms_documents SET current_version_id = 'v3000000-0000-0000-0000-000000000001' WHERE document_id = 'c3000000-0000-0000-0000-000000000001';
UPDATE dms_documents SET current_version_id = 'v3000000-0000-0000-0000-000000000002' WHERE document_id = 'c3000000-0000-0000-0000-000000000002';
UPDATE dms_documents SET current_version_id = 'v4000000-0000-0000-0000-000000000001' WHERE document_id = 'c4000000-0000-0000-0000-000000000001';
UPDATE dms_documents SET current_version_id = 'v4000000-0000-0000-0000-000000000002' WHERE document_id = 'c4000000-0000-0000-0000-000000000002';
UPDATE dms_documents SET current_version_id = 'vd000000-0000-0000-0000-000000000001' WHERE document_id = 'd1000000-0000-0000-0000-000000000001';
UPDATE dms_documents SET current_version_id = 'vd000000-0000-0000-0000-000000000002' WHERE document_id = 'd1000000-0000-0000-0000-000000000002';
UPDATE dms_documents SET current_version_id = 'vd000000-0000-0000-0000-000000000003' WHERE document_id = 'd1000000-0000-0000-0000-000000000003';
UPDATE dms_documents SET current_version_id = 'vd000000-0000-0000-0000-000000000004' WHERE document_id = 'd2000000-0000-0000-0000-000000000001';
UPDATE dms_documents SET current_version_id = 'vd000000-0000-0000-0000-000000000005' WHERE document_id = 'd3000000-0000-0000-0000-000000000001';
UPDATE dms_documents SET current_version_id = 'vd000000-0000-0000-0000-000000000006' WHERE document_id = 'd3000000-0000-0000-0000-000000000002';

-- ========== 5. SEED TASKS ==========

INSERT INTO dms_tasks (task_id, title, description, task_type, status, priority, assigned_to_id, assigned_by_id, due_date, created_at, updated_at) VALUES
-- Open tasks
('t1000000-0000-0000-0000-000000000001', 'Review Quality Manual Update', 'Review the updated Quality Manual v3.0 and provide feedback', 'correction', 'open', 'high', '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', now() + interval '7 days', now(), now()),
('t1000000-0000-0000-0000-000000000002', 'Complete RCA for Production Issue', 'Root cause analysis for the quality incident on 2026-07-15', 'rca', 'open', 'critical', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', now() + interval '3 days', now(), now()),

-- In Progress tasks
('t1000000-0000-0000-0000-000000000003', 'Update Access Control Procedure', 'Incorporate new MFA requirements into access control documentation', 'correction', 'in_progress', 'high', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', now() + interval '5 days', now() - interval '2 days', now() - interval '2 days'),
('t1000000-0000-0000-0000-000000000004', 'Conduct ISO 9001 Internal Audit', 'Perform quarterly internal audit for QMS compliance', 'audit_action', 'in_progress', 'medium', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', now() + interval '14 days', now() - interval '5 days', now() - interval '5 days'),

-- Completed tasks
('t1000000-0000-0000-0000-000000000005', 'Update Employee Training Records', 'Record completion of ISO 27001 awareness training', 'audit_action', 'done', 'low', '40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', now() - interval '5 days', now() - interval '10 days', now() - interval '5 days'),
('t1000000-0000-0000-0000-000000000006', 'Process Corrective Action', 'Document and implement CAR-2026-0015', 'correction', 'done', 'high', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', now() - interval '2 days', now() - interval '15 days', now() - interval '2 days'),

-- Overdue task
('t1000000-0000-0000-0000-000000000007', 'Submit Management Review Report', 'Complete and submit the H1 2026 management review', 'audit_action', 'open', 'critical', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', now() - interval '3 days', now() - interval '20 days', now() - interval '20 days')
ON CONFLICT DO NOTHING;

-- ========== 6. SEED REMINDERS ==========

INSERT INTO dms_reminders (reminder_id, task_id, recipient_id, reminder_type, is_read, message, due_date, sent_at, created_at) VALUES
-- Pending reminders
('r1000000-0000-0000-0000-000000000001', 't1000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'task_due', false, 'Quality Manual review task due in 7 days', now() + interval '7 days', now() + interval '1 day', now()),
('r1000000-0000-0000-0000-000000000002', 't1000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'task_due', false, 'RCA for production issue due in 3 days', now() + interval '3 days', now() + interval '1 day', now()),

-- Sent reminders
('r1000000-0000-0000-0000-000000000003', 't1000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000001', 'task_overdue', true, 'Management review report is 3 days overdue', now() - interval '3 days', now() - interval '2 days', now() - interval '5 days'),
('r1000000-0000-0000-0000-000000000004', 't1000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', 'task_due', true, 'Access Control Procedure update reminder', now() + interval '5 days', now() - interval '1 day', now() - interval '2 days')
ON CONFLICT DO NOTHING;

-- ========== 7. SEED FOLDER PERMISSIONS ==========

INSERT INTO dms_folder_permissions (permission_id, folder_id, user_id, role, granted_at) VALUES
-- QMS Management Documents - Permissions
('p1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Manager', now() - interval '180 days'),
('p1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'Writer', now() - interval '180 days'),
('p1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Reader', now() - interval '180 days'),
('p1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 'Reader', now() - interval '180 days'),

-- QMS Work Instructions - Permissions
('p2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Manager', now() - interval '150 days'),
('p2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Reader', now() - interval '150 days'),
('p2000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 'Reader', now() - interval '150 days'),

-- ISMS Policies - Permissions
('p3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Manager', now() - interval '200 days'),
('p3000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Manager', now() - interval '200 days'),
('p3000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Reader', now() - interval '200 days'),

-- ISMS Restricted Access - Permissions
('p3000000-0000-0000-0000-000000000004', 'b3000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Manager', now() - interval '90 days'),
('p3000000-0000-0000-0000-000000000005', 'b3000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Manager', now() - interval '90 days')
ON CONFLICT DO NOTHING;

-- ========== 8. SEED AUDIT TRAIL ENTRIES ==========

INSERT INTO dms_audit_trails (log_id, user_id, action, metadata, created_at) VALUES
-- Document uploads
('a1000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'DOCUMENT_UPLOADED', '{"documentId":"c1000000-0000-0000-0000-000000000001","title":"Quality Management Policy v2.1","folderId":"a1000000-0000-0000-0000-000000000001","fileSize":245000}', now() - interval '5 hours'),
('a1000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'DOCUMENT_UPLOADED', '{"documentId":"c1000000-0000-0000-0000-000000000002","title":"Management Review Procedure","folderId":"a1000000-0000-0000-0000-000000000001","fileSize":156000}', now() - interval '4 hours'),

-- Document downloads
('a1000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', 'DOCUMENT_DOWNLOADED', '{"documentId":"c1000000-0000-0000-0000-000000000005","title":"Quality Manual v3.0","folderId":"a1000000-0000-0000-0000-000000000001"}', now() - interval '3 hours'),
('a1000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000002', 'DOCUMENT_DOWNLOADED', '{"documentId":"c1000000-0000-0000-0000-000000000006","title":"Customer Complaint Procedure","folderId":"a1000000-0000-0000-0000-000000000001"}', now() - interval '2 hours'),

-- Document checkouts
('a1000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', 'DOCUMENT_CHECKOUT', '{"documentId":"c1000000-0000-0000-0000-000000000001","title":"Quality Management Policy v2.1","expiresAt":"' || (now() + interval '1 hour')::text || '"}', now() - interval '1 hour'),
('a1000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000001', 'DOCUMENT_CHECKIN', '{"documentId":"c1000000-0000-0000-0000-000000000001","title":"Quality Management Policy v2.1"}', now() - interval '30 minutes'),

-- Task operations
('a1000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', 'TASK_CREATED', '{"taskId":"t1000000-0000-0000-0000-000000000001","title":"Review Quality Manual Update","assignedTo":"40000000-0000-0000-0000-000000000001"}', now() - interval '3 days'),
('a1000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000001', 'TASK_COMPLETED', '{"taskId":"t1000000-0000-0000-0000-000000000005","title":"Update Employee Training Records"}', now() - interval '5 days'),

-- Permission operations
('a1000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'PERMISSION_GRANTED', '{"folderId":"a1000000-0000-0000-0000-000000000001","userId":"40000000-0000-0000-0000-000000000001","role":"Reader"}', now() - interval '180 days'),

-- User operations
('a1000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'USER_CREATED', '{"userId":"30000000-0000-0000-0000-000000000001","fullName":"Mohammed Hassan","email":"mohammed.hassan@si-ware.com"}', now() - interval '365 days')
ON CONFLICT DO NOTHING;

-- ========== 9. VERIFY DATA ==========

SELECT 'Data Seeding Complete!' as status,
       (SELECT COUNT(*) FROM dms_users) as user_count,
       (SELECT COUNT(*) FROM dms_folders) as folder_count,
       (SELECT COUNT(*) FROM dms_documents) as document_count,
       (SELECT COUNT(*) FROM dms_document_versions) as version_count,
       (SELECT COUNT(*) FROM dms_tasks) as task_count,
       (SELECT COUNT(*) FROM dms_reminders) as reminder_count,
       (SELECT COUNT(*) FROM dms_folder_permissions) as permission_count,
       (SELECT COUNT(*) FROM dms_audit_trails) as audit_count;
