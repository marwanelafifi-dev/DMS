namespace DMS.Api.Models;

public class DmsGroupMember
{
    public Guid GroupMemberId { get; set; }
    public Guid GroupId { get; set; }
    public Guid UserId { get; set; }
    public DateTime AddedAt { get; set; }

    public DmsGroup? Group { get; set; }
    public DmsUser? User { get; set; }
}
