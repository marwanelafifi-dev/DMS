namespace DMS.Api.Models;

// Read model for an exact KnowledgeTree content-version/file relationship.
// Historical rows point to the separate legacy/archive MinIO namespace; the
// one current source row points back to the normal migrated New-DMS version.
public class DmsLegacyContentVersion
{
    public string SourceSystem { get; set; } = string.Empty;
    public long LegacyContentVersionId { get; set; }
    public long LegacyDocumentId { get; set; }
    public int MajorVersion { get; set; }
    public int MinorVersion { get; set; }
    public string OriginalFilename { get; set; } = string.Empty;
    public string? SourceStoragePath { get; set; }
    public long? SourceSizeBytes { get; set; }
    public string? SourceMd5 { get; set; }
    public bool IsActiveSource { get; set; }
    public string PhysicalFileStatus { get; set; } = string.Empty;
    public string? ArchiveObjectKey { get; set; }
    public string? ArchiveSha256 { get; set; }
    public DateTime ArchivedAt { get; set; }
}

public class DmsLegacyContentFileDetail
{
    public string SourceSystem { get; set; } = string.Empty;
    public long LegacyContentVersionId { get; set; }
    public DateTime? SourceFileModifiedAt { get; set; }
    public DateTime ObservedAt { get; set; }
}
