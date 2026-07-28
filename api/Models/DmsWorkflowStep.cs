namespace DMS.Api.Models;

public class DmsWorkflowStep
{
    public Guid StepId { get; set; }
    public Guid WorkflowId { get; set; }
    public int StepIndex { get; set; }
    public string StepType { get; set; } = string.Empty;
    public Guid? AssignedToId { get; set; }
    public string Status { get; set; } = "pending";
    public string? Comment { get; set; }
    public Guid? CompletedById { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime CreatedAt { get; set; }
}
