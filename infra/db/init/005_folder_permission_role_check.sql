-- Constrain dms_folder_permissions.role to the same fixed set of role names
-- that RBACMiddleware.HasPermissionForMethod() already checks against in code
-- (Reader/Writer/Manager/QA/Admin). Previously this was a free-text column with
-- nothing enforcing consistency between the DB and the C# role checks.
--
-- Like 003/004, this only auto-runs on a brand-new empty Postgres volume. On an
-- existing database, apply manually:
--   docker compose exec -T postgres psql -U dms_app -d dms -f /path/to/this/file
-- (or paste the ALTER TABLE statement directly).

ALTER TABLE dms_folder_permissions
    ADD CONSTRAINT chk_folder_permissions_role
    CHECK (role IN ('Reader', 'Writer', 'Manager', 'QA', 'Admin'));
