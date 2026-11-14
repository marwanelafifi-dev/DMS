namespace DMS.Api.Models;

public class DmsAuditCalendarEvent
{
    public Guid EventId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Phase { get; set; } = string.Empty;
    public string Standard { get; set; } = string.Empty;
    public DateOnly EventDate { get; set; }
    public string? Notes { get; set; }
    public int? ProgrammeYear { get; set; }
    public Guid? AuditCycleId { get; set; }
    public string? StageKey { get; set; }
    public string Status { get; set; } = "planned";
    public Guid? OwnerId { get; set; }
    public DateOnly? DueDate { get; set; }
    public Guid PostedBy { get; set; }
    public DateTime CreatedAt { get; set; }

    public DmsUser? PostedByUser { get; set; }
    public DmsUser? Owner { get; set; }
}
