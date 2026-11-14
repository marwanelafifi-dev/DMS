namespace DMS.Api.Models;

// Associates the immutable version that was submitted as evidence with the
// audit cycle it supports. A document may therefore retain its 2026–2027
// evidence version while a later revision is assigned to 2027–2028.
public class DmsEvidenceVersionCycleAssignment
{
    public Guid DocumentId { get; set; }
    public Guid AuditCycleId { get; set; }
    public Guid VersionId { get; set; }
    public string Standard { get; set; } = string.Empty;
    public Guid AssignedBy { get; set; }
    public DateTime AssignedAt { get; set; }
}
