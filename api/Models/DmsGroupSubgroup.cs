namespace DMS.Api.Models;

// A group can contain other groups as members (nested groups), in addition
// to users (see DmsGroupMember). ParentGroupId is the containing group;
// ChildGroupId is the group nested inside it.
public class DmsGroupSubgroup
{
    public Guid GroupSubgroupId { get; set; }
    public Guid ParentGroupId { get; set; }
    public Guid ChildGroupId { get; set; }
    public DateTime AddedAt { get; set; }

    public DmsGroup? ParentGroup { get; set; }
    public DmsGroup? ChildGroup { get; set; }
}
