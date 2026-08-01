namespace DMS.Api.Models;

// Editable, DB-backed permission flags per role. RBACMiddleware reads this
// table (instead of a hardcoded switch) to decide whether a given HTTP method
// is allowed for a role on a folder/document endpoint; FoldersController and
// TasksController read the Create*/Delete*/AddTask flags directly since those
// actions aren't gated by the generic method map (folder/task creation has no
// entity ID yet); ApprovalsController reads Approve/Reject to gate QA/Manager
// decisions.
public class DmsRolePermission
{
    public string Role { get; set; } = string.Empty;
    public bool ViewOnly { get; set; }
    public bool DownloadReadOnly { get; set; }
    public bool DownloadForEditing { get; set; }
    public bool Upload { get; set; }
    public bool UpdateFile { get; set; }
    public bool UpdateFolder { get; set; }
    public bool CreateSubfolder { get; set; }
    public bool CreateParentFolder { get; set; }
    public bool AddTask { get; set; }
    public bool DeleteParentFolder { get; set; }
    public bool DeleteSubfolder { get; set; }
    public bool DeleteFile { get; set; }
    public bool SubmitForApproval { get; set; }
    public bool Approve { get; set; }
    public bool Reject { get; set; }
    public bool AdminForceUnlock { get; set; }
    public DateTime UpdatedAt { get; set; }
}
