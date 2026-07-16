using System.Text.Json;

namespace DMS.Api.Models;

public class DmsAuditTrail
{
    public Guid LogId { get; set; }
    public Guid UserId { get; set; }
    public string Action { get; set; } = string.Empty;
    public JsonDocument? Metadata { get; set; }
    public DateTime CreatedAt { get; set; }
}
