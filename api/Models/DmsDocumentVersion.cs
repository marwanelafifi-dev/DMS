namespace DMS.Api.Models;

public class DmsDocumentVersion
{
    public Guid VersionId { get; set; }
    public Guid DocumentId { get; set; }
    public string VersionNumber { get; set; } = string.Empty;
    // User-supplied version label (e.g. "v2.1", "Rev A"), typed at upload time —
    // separate from VersionNumber/MajorVersion/MinorVersion, which the system
    // manages itself for checkout/approval and must never be hand-edited.
    public string? VersionLabel { get; set; }
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
    // Version deletion is a compliance-safe tombstone: the row remains so
    // immutable approval/signature/OCR evidence can continue to reference it,
    // while normal application queries no longer expose or use the version.
    public DateTime? DeletedAt { get; set; }
    public Guid? DeletedById { get; set; }

    public DmsDocument? Document { get; set; }
    public DmsUser? SubmittedBy { get; set; }
}
