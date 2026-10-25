namespace DMS.Api.Models;

// A shortcut is deliberately only a pointer to an existing DMS object. It has
// no MinIO key, version, or copied document metadata, so updating the original
// document or folder is immediately reflected wherever the shortcut appears.
public class DmsLibraryShortcut
{
    public Guid ShortcutId { get; set; }
    public Guid ParentFolderId { get; set; }
    public Guid? TargetFolderId { get; set; }
    public Guid? TargetDocumentId { get; set; }
    public Guid CreatedById { get; set; }
    public DateTime CreatedAt { get; set; }
}
