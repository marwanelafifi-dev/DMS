namespace DMS.Api.Models;

public class DmsFolderPermission
{
    public Guid PermissionId { get; set; }
    public Guid FolderId { get; set; }
    public Guid UserId { get; set; }
    public string Role { get; set; } = string.Empty;
    public DateTime GrantedAt { get; set; }
    public Guid? GrantedById { get; set; }
}
