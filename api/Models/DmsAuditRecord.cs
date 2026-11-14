namespace DMS.Api.Models;

public class DmsAuditRecord
{
    public Guid AuditRecordId { get; set; }
    public Guid AuditCycleId { get; set; }
    public string Standard { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string AuditType { get; set; } = string.Empty;
    public string Status { get; set; } = "planned";
    public DateOnly AuditDate { get; set; }
    public string Scope { get; set; } = string.Empty;
    public string[] Departments { get; set; } = Array.Empty<string>();
    public string[] AuditTeam { get; set; } = Array.Empty<string>();
    public Guid[] AuditTeamUserIds { get; set; } = Array.Empty<Guid>();
    public Guid[] ParticipantUserIds { get; set; } = Array.Empty<Guid>();
    public string? AuditPlanReference { get; set; }
    public string? AuditReportReference { get; set; }
    public Guid? AuditPlanDocumentId { get; set; }
    public Guid? AuditReportDocumentId { get; set; }
    public string? Notes { get; set; }
    public Guid CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
