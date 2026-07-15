namespace DMS.Api.Models;

public class DmsEsignature
{
    public Guid SignatureId { get; set; }
    public Guid VersionId { get; set; }
    public Guid UserId { get; set; }
    public string SignatureHash { get; set; } = string.Empty;
    public string? SignatureMeta { get; set; }
    public DateTime CreatedAt { get; set; }
}
