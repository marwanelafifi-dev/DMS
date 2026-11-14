namespace DMS.Api.Models;

public class DmsManagementReviewEntry
{
    public Guid ManagementReviewEntryId { get; set; }
    public Guid AuditCycleId { get; set; }
    public string Standard { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Detail { get; set; }
    public string Status { get; set; } = "open";
    public Guid? OwnerId { get; set; }
    public DateOnly? DueDate { get; set; }
    public Guid? SourceDocumentId { get; set; }
    public Guid CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
