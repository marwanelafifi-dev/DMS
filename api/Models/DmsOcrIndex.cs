namespace DMS.Api.Models;

public class DmsOcrIndex
{
    public Guid OcrId { get; set; }
    public Guid VersionId { get; set; }
    public string ExtractedText { get; set; } = string.Empty;
    public int? PageCount { get; set; }
    public DateTime CreatedAt { get; set; }
}
