namespace DMS.Api.Models;

public class DmsTaskAttachment
{
    public Guid AttachmentId { get; set; }
    public Guid TaskId { get; set; }
    public string FileName { get; set; } = string.Empty;
    public long? FileSizeBytes { get; set; }
    public string? MimeType { get; set; }
    public string S3ObjectKey { get; set; } = string.Empty;
    public Guid UploadedBy { get; set; }
    public DateTime CreatedAt { get; set; }

    public DmsUser? UploadedByUser { get; set; }
}
