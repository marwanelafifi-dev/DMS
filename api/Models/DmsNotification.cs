namespace DMS.Api.Models;

public class DmsNotification
{
    public Guid NotificationId { get; set; }
    public Guid UserId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Body { get; set; }
    public Guid? DocumentId { get; set; }
    public bool IsRead { get; set; }
    public DateTime CreatedAt { get; set; }
}
