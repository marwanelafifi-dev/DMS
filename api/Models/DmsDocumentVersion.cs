namespace DMS.Api.Models;

public class DmsDocumentVersion
{
    public Guid VersionId { get; set; }
    public Guid DocumentId { get; set; }
    public string VersionNumber { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public long? FileSizeBytes { get; set; }
    public string? MimeType { get; set; }
    public string S3ObjectKey { get; set; } = string.Empty;
    public string Sha256Hash { get; set; } = string.Empty;
    public string Status { get; set; } = "draft";
    public bool IsCheckedOut { get; set; } = false;
    public Guid? CheckedOutById { get; set; }
    public DateTime? CheckedOutAt { get; set; }
    public string? CheckoutReason { get; set; }
    public Guid? SubmittedById { get; set; }
    public DateTime? SubmittedAt { get; set; }
    public Guid? ApprovedById { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public string? ApprovalComment { get; set; }
    public int MajorVersion { get; set; } = 1;
    public int MinorVersion { get; set; } = 0;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
