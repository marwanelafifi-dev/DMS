namespace DMS.Api.Models;

// Editable, DB-backed permission flags per folder-permission role. RBACMiddleware
// reads this table (instead of a hardcoded switch) to decide whether a given
// HTTP method is allowed for a role on a folder/document endpoint, and
// ApprovalsController reads Approve/Reject to gate QA/Manager decisions.
public class DmsRolePermission
{
    public string Role { get; set; } = string.Empty;
    public bool ViewOnly { get; set; }
    public bool DownloadReadOnly { get; set; }
    public bool Upload { get; set; }
    public bool UpdatePermission { get; set; }
    public bool Approve { get; set; }
    public bool Reject { get; set; }
    public bool AdminForceUnlock { get; set; }
    public DateTime UpdatedAt { get; set; }
}
