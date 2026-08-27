namespace DMS.Api.Models;

public class DmsFolder
{
    public Guid FolderId { get; set; }
    public Guid? ParentFolderId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Classification { get; set; } = "standard";
    public string? Department { get; set; }
    public string[] Tags { get; set; } = Array.Empty<string>();
    public Guid OwnerId { get; set; }
    public string? MetadataSchema { get; set; }
    public string? RetentionPolicy { get; set; }
    public int? RetentionYears { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public DateTime? DeletedAt { get; set; }
    public Guid? DeletedById { get; set; }
    public Guid? DeletionBatchId { get; set; }
}
