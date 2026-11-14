namespace DMS.Api.Models;

public class DmsIsoReadinessContact
{
    public Guid AuditCycleId { get; set; }
    public Guid DepartmentFolderId { get; set; }
    public Guid UserId { get; set; }
    public Guid? AssignedBy { get; set; }
    public DateTime AssignedAt { get; set; }
}
