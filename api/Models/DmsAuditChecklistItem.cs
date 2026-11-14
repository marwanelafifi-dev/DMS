namespace DMS.Api.Models;

public class DmsAuditChecklistItem
{
    public Guid AuditChecklistItemId { get; set; }
    public Guid AuditRecordId { get; set; }
    public string Process { get; set; } = string.Empty;
    public string Clause { get; set; } = string.Empty;
    public string Requirement { get; set; } = string.Empty;
    public string Result { get; set; } = "not_assessed";
    public string? ObjectiveEvidence { get; set; }
    public string? AuditorNotes { get; set; }
    public Guid? PcarTaskId { get; set; }
    public Guid CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
