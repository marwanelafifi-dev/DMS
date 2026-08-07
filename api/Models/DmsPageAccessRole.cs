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
    // Weaker, tiered versions of BypassFolderPermissions — automatic
    // visibility (and, for the write variant, upload/edit rights) on every
    // folder with no per-folder grant needed, but capped well short of Admin
    // (no delete, no permission management). A per-folder grant or an
    // explicit Deny override still takes precedence, same as
    // BypassFolderPermissions. Mutually exclusive in practice (the stronger
    // one wins if both are somehow set) — see BaseController.GetEffectiveRoleAsync.
    public bool CanReadAllFolders { get; set; }
    public bool CanReadWriteAllFolders { get; set; }
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
    // Independent from CanManageAllTasks — lets a role change an existing
    // task's Assignee (user or group) on ANY task, own or not, without also
    // granting edit/complete/delete over tasks that already belong to other
    // people.
    public bool CanReassignTasks { get; set; }
    // Narrower sibling of CanReassignTasks — lets a role reassign only tasks
    // it already owns (is the assignee or manager of) to someone else, with
    // no visibility or action on other people's tasks at all.
    public bool CanReassignMyTasks { get; set; }
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
    // Independent of CanApprove/CanViewQaStage — lets a role manually enter or
    // system-generate a document's Original Document ID at QA Triage, without
    // also needing the broader QA Accept/Reject action rights.
    public bool CanResolveDocumentId { get; set; }
    // Whether this role can post to the Send Announcement page — independent
    // of any per-folder grant, same as the other blanket role-wide flags above.
    public bool CanSendAnnouncements { get; set; }
    // Set once at creation (true only for the 5 original seeded roles) and
    // carried over verbatim by a rename — the stable identity that delete
    // protection checks, instead of matching against the current role name.
    public bool IsBuiltIn { get; set; }
    public DateTime UpdatedAt { get; set; }
}
