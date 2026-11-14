namespace DMS.Api.Models;

public class DmsAuditCycle
{
    public Guid AuditCycleId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Standard { get; set; } = string.Empty;
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public string Status { get; set; } = "planned";
    public DateTime CreatedAt { get; set; }
    public Guid CreatedBy { get; set; }
}
