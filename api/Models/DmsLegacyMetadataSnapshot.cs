using System.Text.Json;

namespace DMS.Api.Models;

// Read model for immutable metadata snapshots imported from KnowledgeTree.
// RawMetadata retains the dynamic legacy field collection so the API does not
// silently discard fields unknown to the current New-DMS metadata model.
public class DmsLegacyMetadataSnapshot
{
    public string SourceSystem { get; set; } = string.Empty;
    public long LegacyMetadataVersionId { get; set; }
    public long LegacyDocumentId { get; set; }
    public long? LegacyContentVersionId { get; set; }
    public int MetadataSequence { get; set; }
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? OriginalAuthors { get; set; }
    public string? IpNumber { get; set; }
    public string? InternalExternal { get; set; }
    public string? OriginalDocumentNumber { get; set; }
    public string? LegacyGroup { get; set; }
    public string? LegacyDocumentType { get; set; }
    public string? LegacyTags { get; set; }
    public bool IsCurrentSnapshot { get; set; }
    public DateTime? SnapshotCreatedAt { get; set; }
    public JsonDocument RawMetadata { get; set; } = JsonDocument.Parse("{}");
    public DateTime ArchivedAt { get; set; }
}
