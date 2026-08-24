namespace DMS.Api.Models;

// Read model for KnowledgeTree provenance. Archive values are append-only;
// deleting the active New-DMS target only detaches its nullable references and
// records their immutable UUIDs in the tombstone fields below.
public class DmsLegacyDocumentMapping
{
    public string SourceSystem { get; set; } = string.Empty;
    public long LegacyDocumentId { get; set; }
    public Guid? NewDocumentId { get; set; }
    public long ActiveLegacyContentVersionId { get; set; }
    public Guid? ActiveNewVersionId { get; set; }
    public Guid? DeletedNewDocumentId { get; set; }
    public Guid? DeletedActiveNewVersionId { get; set; }
    public DateTime? TargetDeletedAt { get; set; }
    public Guid MigrationRunId { get; set; }
    public DateTime MigratedAt { get; set; }
}
