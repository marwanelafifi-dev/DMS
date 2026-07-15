namespace DMS.Api.Models;

public class DmsDocumentMetadata
{
    public Guid MetadataId { get; set; }
    public Guid VersionId { get; set; }
    public string CustomData { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}
