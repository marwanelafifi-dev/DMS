namespace DMS.Api.Models;

public class DmsEvidenceRequirement
{
    public Guid EvidenceRequirementId { get; set; }
    public Guid AuditCycleId { get; set; }
    public Guid RelatedDocumentId { get; set; }
    public string Standard { get; set; } = string.Empty;
    public Guid CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
}
