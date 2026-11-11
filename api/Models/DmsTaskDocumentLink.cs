namespace DMS.Api.Models;

public class DmsTaskDocumentLink
{
    public Guid TaskId { get; set; }
    public Guid DocumentId { get; set; }
    public DateTime LinkedAt { get; set; }
}
