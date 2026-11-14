namespace DMS.Api.Models;

public class DmsEvidenceLink
{
    public Guid EvidenceLinkId { get; set; }
    public Guid EvidenceDocumentId { get; set; }
    public Guid RelatedDocumentId { get; set; }
    public int ProgrammeYear { get; set; }
    public Guid? AuditCycleId { get; set; }
    public Guid OwnerId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DmsDocument? EvidenceDocument { get; set; }
    public DmsDocument? RelatedDocument { get; set; }
    public DmsUser? Owner { get; set; }
}
