namespace DMS.Api.Models;

// Immutable archive of a PCAR record imported from the previous service desk.
// It is deliberately separate from DmsTask: archived work must never appear in
// a current employee's actionable queue or be altered by the live workflow.
public class DmsHistoricalPcar
{
    public Guid HistoricalPcarId { get; set; }
    public string SourceSystem { get; set; } = "manageengine";
    public string LegacyRequestId { get; set; } = string.Empty;
    public string? GroupName { get; set; }
    public string? RequesterName { get; set; }
    public string? Department { get; set; }
    public string? Category { get; set; }
    public string? Subject { get; set; }
    public string? Description { get; set; }
    public string? HistoricalOwnerName { get; set; }
    public Guid? LinkedUserId { get; set; }
    public string? Priority { get; set; }
    public string? Severity { get; set; }
    public string? SourceStatus { get; set; }
    public string? Resolution { get; set; }
    public string? ClosureCode { get; set; }
    public string? ClosureComments { get; set; }
    public DateTime? SourceCreatedAt { get; set; }
    public DateTime? SourceDueAt { get; set; }
    public DateTime? SourceCompletedAt { get; set; }
    public DateTime? SourceUpdatedAt { get; set; }
    public Guid ImportedById { get; set; }
    public DateTime ImportedAt { get; set; }

    public DmsUser? LinkedUser { get; set; }
}
