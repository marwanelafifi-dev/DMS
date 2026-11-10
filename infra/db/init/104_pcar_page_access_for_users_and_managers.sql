-- PCAR visibility is separate from PCAR creation. Users see only PCARs in
-- their own task queue; Managers also see PCARs they assigned to their team.
-- TaskService.GetMyTasksAsync already enforces those row-level boundaries.
UPDATE dms_page_access_roles
SET can_view_pcar = TRUE
WHERE role IN ('User', 'Manager');
