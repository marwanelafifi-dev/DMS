namespace DMS.Api.Models;

public class DmsReminder
{
    public Guid ReminderId { get; set; }
    public Guid TaskId { get; set; }
    public Guid RecipientId { get; set; }
    public string ReminderType { get; set; } = string.Empty;
    public DateTime DueDate { get; set; }
    public bool IsSent { get; set; } = false;
    public DateTime? SentAt { get; set; }
    public DateTime CreatedAt { get; set; }

    public DmsTask? Task { get; set; }
    public DmsUser? Recipient { get; set; }
}
