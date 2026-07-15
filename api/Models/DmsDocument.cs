namespace DMS.Api.Models;

public class DmsDocument
{
    public Guid DocumentId { get; set; }
    public Guid FolderId { get; set; }
    public string Title { get; set; } = string.Empty;
    public Guid? CurrentVersionId { get; set; }
    public string? TrackingCode { get; set; }
    public string Status { get; set; } = "draft";
    public Guid OwnerId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
