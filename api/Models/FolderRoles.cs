namespace DMS.Api.Models;

// Canonical set of dms_folder_permissions.role values. Mirrors the CHECK constraint added in
// infra/db/init/005_folder_permission_role_check.sql and the role checks in
// RBACMiddleware.HasPermissionForMethod() — keep all three in sync if this list ever changes.
public static class FolderRoles
{
    public const string Reader = "Reader";
    public const string Writer = "Writer";
    public const string Manager = "Manager";
    public const string QA = "QA";
    public const string Admin = "Admin";

    public static readonly string[] All = [Reader, Writer, Manager, QA, Admin];

    public static bool IsValid(string? role) => role != null && All.Contains(role);
}
