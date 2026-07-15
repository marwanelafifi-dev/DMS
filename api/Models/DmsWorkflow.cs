namespace DMS.Api.Models;

public class DmsWorkflow
{
    public Guid WorkflowId { get; set; }
    public Guid? DocumentId { get; set; }
    public Guid? TaskId { get; set; }
    public Guid TemplateId { get; set; }
    public int CurrentStepIndex { get; set; } = 0;
    public string Status { get; set; } = "active";
    public DateTime StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}
