namespace DMS.Api.Models;

// Read model for KnowledgeTree provenance. The underlying table is protected
// by append-only database triggers; the application exposes it only through a
// GET endpoint and never adds it to a migration/workflow write path.
public class DmsLegacyDocumentMapping
{
    public string SourceSystem { get; set; } = string.Empty;
    public long LegacyDocumentId { get; set; }
    public Guid NewDocumentId { get; set; }
    public long ActiveLegacyContentVersionId { get; set; }
    public Guid ActiveNewVersionId { get; set; }
    public Guid MigrationRunId { get; set; }
    public DateTime MigratedAt { get; set; }
}
