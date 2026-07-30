namespace DMS.Api.Models;

// Editable, DB-backed permission flags per folder-permission role. RBACMiddleware
// reads this table (instead of a hardcoded switch) to decide whether a given
// HTTP method is allowed for a role on a folder/document endpoint.
public class DmsRolePermission
{
    public string Role { get; set; } = string.Empty;
    public bool ViewOnly { get; set; }
    public bool DownloadReadOnly { get; set; }
    public bool DownloadForEditing { get; set; }
    public bool AdminForceUnlock { get; set; }
    public DateTime UpdatedAt { get; set; }
}
