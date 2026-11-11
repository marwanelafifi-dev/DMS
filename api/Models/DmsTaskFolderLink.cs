namespace DMS.Api.Models;

public class DmsTaskFolderLink
{
    public Guid TaskId { get; set; }
    public Guid FolderId { get; set; }
    public DateTime LinkedAt { get; set; }
}
