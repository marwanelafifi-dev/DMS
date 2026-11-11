-- Canonical audit-register access model. This makes the agreed built-in role
-- boundaries explicit while folder owners and designated folder managers keep
-- their separate, resource-scoped rights in TaskService.
ALTER TABLE dms_page_access_roles
    ADD COLUMN IF NOT EXISTS can_manage_task_reminder_policy BOOLEAN NOT NULL DEFAULT FALSE;

-- Quality oversees the entire live register: it can create, manage, reassign,
-- verify, and delete Tasks/PCARs, and administer their automatic schedule.
UPDATE dms_page_access_roles
SET can_view_tasks = TRUE,
    can_view_pcar = TRUE,
    can_view_all_tasks = TRUE,
    can_manage_all_tasks = TRUE,
    can_delete_tasks = TRUE,
    can_create_tasks = TRUE,
    can_create_pcars = TRUE,
    can_verify_pcars = TRUE,
    can_reassign_tasks = TRUE,
    can_manage_task_reminder_policy = TRUE
WHERE role = 'Quality';

-- Full Access retains the same complete register authority and the schedule
-- administration capability, in addition to its existing system privileges.
UPDATE dms_page_access_roles
SET can_view_tasks = TRUE,
    can_view_pcar = TRUE,
    can_view_all_tasks = TRUE,
    can_manage_all_tasks = TRUE,
    can_delete_tasks = TRUE,
    can_create_tasks = TRUE,
    can_create_pcars = TRUE,
    can_verify_pcars = TRUE,
    can_reassign_tasks = TRUE,
    can_manage_task_reminder_policy = TRUE
WHERE role = 'Full Access';

-- Auditors can oversee both registers and work with audit findings, but do
-- not receive normal-task administration, deletion, or reminder-policy power.
UPDATE dms_page_access_roles
SET can_view_tasks = TRUE,
    can_view_pcar = TRUE,
    can_view_all_tasks = TRUE,
    can_create_tasks = FALSE,
    can_create_pcars = TRUE,
    can_verify_pcars = TRUE,
    can_manage_all_tasks = FALSE,
    can_delete_tasks = FALSE,
    can_reassign_tasks = FALSE,
    can_reassign_my_tasks = FALSE,
    can_manage_task_reminder_policy = FALSE
WHERE role = 'Auditor';

-- Managers and Users stay resource-scoped. A Manager may create internal
-- tasks; neither role receives global visibility, management, deletion, or
-- automatic-schedule administration. Linked-folder owners/managers are
-- authorized dynamically by TaskService, not by these global flags.
UPDATE dms_page_access_roles
SET can_view_tasks = TRUE,
    can_view_pcar = TRUE,
    can_view_all_tasks = FALSE,
    can_manage_all_tasks = FALSE,
    can_delete_tasks = FALSE,
    can_manage_task_reminder_policy = FALSE,
    can_create_tasks = TRUE,
    can_create_pcars = FALSE,
    can_verify_pcars = FALSE,
    can_reassign_tasks = FALSE,
    can_reassign_my_tasks = FALSE
WHERE role = 'Manager';

UPDATE dms_page_access_roles
SET can_view_tasks = TRUE,
    can_view_pcar = TRUE,
    can_view_all_tasks = FALSE,
    can_manage_all_tasks = FALSE,
    can_delete_tasks = FALSE,
    can_manage_task_reminder_policy = FALSE,
    can_create_tasks = FALSE,
    can_create_pcars = FALSE,
    can_verify_pcars = FALSE,
    can_reassign_tasks = FALSE,
    can_reassign_my_tasks = FALSE
WHERE role = 'User';
