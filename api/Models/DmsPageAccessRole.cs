namespace DMS.Api.Models;

// A user's global role (dms_users.role) is purely about which pages/features
// of the app they can see — Dashboard, Document Library, Approvals (C-Doc
// Workflow), PCAR/Corrective Action, Admin Panel, Reminders. It has nothing
// to do with file/folder actions (upload/delete/rename/download/...), which
// are governed entirely by per-folder grants (DmsFolderPermission) and File/
// Folder Permission overrides (DmsAccessOverride). BypassFolderPermissions is
// the one exception: a "super admin" style flag letting a role's holders see
// every folder's contents even without an explicit per-folder grant.
public class DmsPageAccessRole
{
    public string Role { get; set; } = string.Empty;
    public bool CanViewDashboard { get; set; }
    public bool CanViewDocumentLibrary { get; set; }
    public bool CanViewReminders { get; set; }
    public bool CanViewApprovals { get; set; }
    public bool CanViewPcar { get; set; }
    public bool CanViewAdminPanel { get; set; }
    public bool BypassFolderPermissions { get; set; }
    public DateTime UpdatedAt { get; set; }
}
