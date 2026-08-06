namespace DMS.Api.Models;

public class DmsTask
{
    public Guid TaskId { get; set; }
    public Guid? WorkflowStepId { get; set; }
    public Guid? DocumentId { get; set; }
    public Guid? ApprovalId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string TaskType { get; set; } = string.Empty;
    // Exactly one of AssignedToId / AssignedToGroupId is set — a group
    // assignment is one shared task visible to every member, completable by
    // whoever gets to it first, not a fan-out of duplicate per-member tasks.
    public Guid? AssignedToId { get; set; }
    public Guid? AssignedToGroupId { get; set; }
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
    public Guid? QaReviewedById { get; set; }
    public DateTime? QaReviewedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public DmsUser? AssignedTo { get; set; }
    public DmsGroup? AssignedToGroup { get; set; }
    public DmsDocument? Document { get; set; }
}
