namespace DMS.Api.Models;

// A user designated as one of a folder's Manager(s) — see ApprovalsController's
// RequireFolderManagerAccessAsync for the approval-routing effect this has at
// the Manager Review stage. Composite key (FolderId, UserId); a folder can
// have any number of managers, a user can manage any number of folders.
public class DmsFolderManager
{
    public Guid FolderId { get; set; }
    public Guid UserId { get; set; }
}
