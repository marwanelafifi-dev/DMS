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
    // Blanket, role-wide flags — every user assigned this role can Edit
    // document metadata / manage File and Folder Permissions everywhere,
    // without needing a per-folder Access Override grant.
    public bool CanEditFiles { get; set; }
    public bool CanManageFolderPermissions { get; set; }
    public bool CanManageFilePermissions { get; set; }
    // Blanket ability to edit, complete, or delete ANY task/PCAR — without it,
    // a user can still open and work on tasks assigned to them, but the
    // management action icons (edit/complete/delete) on the register table
    // stay hidden and the API rejects the underlying requests.
    public bool CanManageAllTasks { get; set; }
    // Independent from CanManageAllTasks — lets a role see the "New PCAR"
    // button and assign a task to anyone, without also granting the ability
    // to edit/complete/delete tasks that already belong to other people.
    public bool CanCreateTasks { get; set; }
    // Scopes CanViewApprovals down to specific C-Doc Workflow stage tabs —
    // e.g. Manager only needs Stage 2, Quality only needs Stage 1 and Stage 3.
    // Enforced both in the frontend tab list and in ApprovalsController's
    // queue/action endpoints, not just as a UI-only filter.
    public bool CanViewQaStage { get; set; }
    public bool CanViewManagerStage { get; set; }
    public bool CanViewFinalReleaseStage { get; set; }
    // Whether this role can actually approve/reject a batch in whichever stage
    // it's viewing — decoupled from per-folder role grants entirely. Folder/File
    // Permission overrides and per-folder grants govern file/folder management
    // actions only (upload/rename/copy/cut/delete/...), never approve/reject.
    public bool CanApprove { get; set; }
    public bool CanReject { get; set; }
    public DateTime UpdatedAt { get; set; }
}
