namespace DMS.Api.Models;

public class DmsAuditCycleCoverageFolder
{
    public Guid AuditCycleId { get; set; }
    public Guid FolderId { get; set; }
    public Guid? AddedBy { get; set; }
    public DateTime AddedAt { get; set; }
}
