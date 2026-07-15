namespace DMS.Api.Models;

public class DmsFolder
{
    public Guid FolderId { get; set; }
    public Guid? ParentFolderId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Classification { get; set; } = "standard";
    public Guid OwnerId { get; set; }
    public string? MetadataSchema { get; set; }
    public string? RetentionPolicy { get; set; }
    public int? RetentionYears { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
