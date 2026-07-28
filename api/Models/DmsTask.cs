namespace DMS.Api.Models;

public class DmsTask
{
    public Guid TaskId { get; set; }
    public Guid? WorkflowStepId { get; set; }
    public Guid? DocumentId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string TaskType { get; set; } = string.Empty;
    public Guid AssignedToId { get; set; }
    public Guid? ManagerId { get; set; }
    public string? RiskSeverity { get; set; }
    public DateTime? DueDate { get; set; }
    public string Status { get; set; } = "open";
    public string? RcaText { get; set; }
    public string? PreventiveActions { get; set; }
    public string? EvidenceUrl { get; set; }
    public Guid? CompletedById { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public DmsUser? AssignedTo { get; set; }
    public DmsDocument? Document { get; set; }
}
