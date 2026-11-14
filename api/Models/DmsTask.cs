namespace DMS.Api.Models;

public class DmsTask
{
    public Guid TaskId { get; set; }
    public Guid? WorkflowStepId { get; set; }
    public Guid? DocumentId { get; set; }
    // A normal task may be linked to one file, one folder, or neither (for
    // example, "review your documents"). PCARs always require DocumentId.
    public Guid? FolderId { get; set; }
    public Guid? ApprovalId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string[] Tags { get; set; } = Array.Empty<string>();
    public string TaskType { get; set; } = string.Empty;
    public string? AuditStage { get; set; }
    // Internal Task register reference. PCAR findings use FindingNumber instead.
    public string? TaskNumber { get; set; }
    public string? FindingNumber { get; set; }
    public string? FindingSeverity { get; set; }
    public string? StandardClause { get; set; }
    public string? AuditorNotes { get; set; }
    // Identifies the specific internal/external audit programme that raised a
    // PCAR, keeping unrelated findings out of a surveillance report.
    public string? AuditReference { get; set; }
    public DateOnly? AuditDate { get; set; }
    public string? AuditStandard { get; set; }
    public Guid? AuditCycleId { get; set; }
    public Guid? AuditRecordId { get; set; }
    // Exactly one of AssignedToId / AssignedToGroupId is set — a group
    // assignment is one shared task visible to every member, completable by
    // whoever gets to it first, not a fan-out of duplicate per-member tasks.
    public Guid? AssignedToId { get; set; }
    public Guid? AssignedToGroupId { get; set; }
    // Optional escalation contact for a normal task with no linked document
    // or folder. ManagerId remains the task creator for audit history.
    public Guid? DirectManagerId { get; set; }
    public Guid? ManagerId { get; set; }
    public string? RiskSeverity { get; set; }
    public DateTime? DueDate { get; set; }
    public string Status { get; set; } = "open";
    public string? RcaText { get; set; }
    public string? CorrectionText { get; set; }
    public string? PreventiveActions { get; set; }
    public string? EvidenceUrl { get; set; }
    public Guid? CompletedById { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? QaReviewNotes { get; set; }
    // Explicit effectiveness decision made during PCAR closure verification.
    public string? EffectivenessResult { get; set; }
    public Guid? QaReviewedById { get; set; }
    public DateTime? QaReviewedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public DmsUser? AssignedTo { get; set; }
    public DmsGroup? AssignedToGroup { get; set; }
    public DmsDocument? Document { get; set; }
    public DmsFolder? Folder { get; set; }
}
