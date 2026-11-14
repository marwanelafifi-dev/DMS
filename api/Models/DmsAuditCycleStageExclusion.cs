namespace DMS.Api.Models;

// Optional programme stages are hidden per cycle, not deleted. This keeps the
// historical dates, owners, and notes intact should Quality restore the stage.
public class DmsAuditCycleStageExclusion
{
    public Guid AuditCycleId { get; set; }
    public string StageKey { get; set; } = string.Empty;
    public Guid RemovedBy { get; set; }
    public DateTime RemovedAt { get; set; }
}
