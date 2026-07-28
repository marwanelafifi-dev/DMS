-- The temporary development identity authenticates as "System Admin", while
-- authorization is granted per folder. Give that bootstrap identity Admin
-- access to every seeded folder so the default Documents-page upload target
-- can create a document and upload its first version.
--
-- This runs automatically only for new Postgres volumes. Apply it manually to
-- an existing development database.

INSERT INTO dms_folder_permissions (
    permission_id,
    folder_id,
    user_id,
    role,
    granted_at,
    granted_by_id
)
SELECT
    gen_random_uuid(),
    folder.folder_id,
    dev_admin.user_id,
    'Admin',
    now(),
    dev_admin.user_id
FROM dms_folders AS folder
JOIN dms_users AS dev_admin
    ON dev_admin.user_id = '00000000-0000-0000-0000-000000000001'
ON CONFLICT (folder_id, user_id) DO UPDATE
SET
    role = EXCLUDED.role,
    granted_by_id = EXCLUDED.granted_by_id;
