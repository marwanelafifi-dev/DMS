namespace DMS.Api.Models;

// Every evidence file receives a cycle assignment when it is created. This is
// independent of optional policy/process links, so unlinked evidence is still
// correctly visible as evidence for its ISO programme.
public class DmsEvidenceCycleAssignment
{
    public Guid DocumentId { get; set; }
    public Guid AuditCycleId { get; set; }
    public string Standard { get; set; } = string.Empty;
    public Guid AssignedBy { get; set; }
    public DateTime AssignedAt { get; set; }
}
