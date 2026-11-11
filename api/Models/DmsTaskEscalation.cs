namespace DMS.Api.Models;

public class DmsTaskEscalation
{
    public Guid TaskId { get; set; }
    public string Stage { get; set; } = string.Empty;
    public DateTime SentAt { get; set; }
}
