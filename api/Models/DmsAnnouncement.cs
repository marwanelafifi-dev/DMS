namespace DMS.Api.Models;

// A free-text announcement posted by an Admin/Quality user, shown to every
// user on the Dashboard's ISO calendar card. Optionally fans out an email
// and/or in-app notification to a chosen set of recipients at post time —
// see AnnouncementService.CreateAsync.
public class DmsAnnouncement
{
    public Guid AnnouncementId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public Guid PostedById { get; set; }
    public bool NotifiedEmail { get; set; }
    public bool NotifiedApp { get; set; }
    public int RecipientCount { get; set; }
    public DateTime CreatedAt { get; set; }

    public DmsUser? PostedByUser { get; set; }
}
