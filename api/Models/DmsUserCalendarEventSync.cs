namespace DMS.Api.Models;

public class DmsUserCalendarEventSync
{
    public Guid SyncId { get; set; }
    public Guid UserId { get; set; }
    public Guid EventId { get; set; }
    public string GoogleEventId { get; set; } = string.Empty;
    public DateTime SyncedAt { get; set; }

    public DmsUser? User { get; set; }
    public DmsAuditCalendarEvent? Event { get; set; }
}
