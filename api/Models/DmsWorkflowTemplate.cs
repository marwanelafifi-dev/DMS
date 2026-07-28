namespace DMS.Api.Models;

public class DmsWorkflowTemplate
{
    public Guid TemplateId { get; set; }
    public Guid? FolderId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Steps { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
}
