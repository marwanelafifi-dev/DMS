namespace DMS.Api.Models;

/// <summary>
/// Documents included in a single approval batch
/// </summary>
public class DmsApprovalDocument
{
    public Guid ApprovalDocumentId { get; set; }
    public Guid ApprovalId { get; set; }
    public Guid DocumentId { get; set; }
    public Guid VersionId { get; set; }  // The version submitted for approval
    public DateTime CreatedAt { get; set; }

    // Navigation properties
    public DmsApproval? Approval { get; set; }
    public DmsDocument? Document { get; set; }
    public DmsDocumentVersion? Version { get; set; }
}
