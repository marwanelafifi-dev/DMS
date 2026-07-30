namespace DMS.Api.Models;

public class DmsDocument
{
    public Guid DocumentId { get; set; }
    public Guid FolderId { get; set; }
    public string Title { get; set; } = string.Empty;
    public Guid? CurrentVersionId { get; set; }
    public string? TrackingCode { get; set; }
    public string Status { get; set; } = "draft";
    public string? Description { get; set; }
    public string[] Tags { get; set; } = Array.Empty<string>();
    public string? Department { get; set; }
    public string? Category { get; set; }
    public string? OriginalDocumentId { get; set; }
    public Guid OwnerId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    // Navigation properties
    public DmsUser? Owner { get; set; }
}
