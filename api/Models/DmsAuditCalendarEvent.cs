namespace DMS.Api.Models;

public class DmsAuditCalendarEvent
{
    public Guid EventId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Phase { get; set; } = string.Empty;
    public string Standard { get; set; } = string.Empty;
    public DateOnly EventDate { get; set; }
    public string? Notes { get; set; }
    public Guid PostedBy { get; set; }
    public DateTime CreatedAt { get; set; }

    public DmsUser? PostedByUser { get; set; }
}
