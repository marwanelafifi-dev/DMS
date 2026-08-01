namespace DMS.Api.Models;

// A narrow, per-file or per-folder exception layered on top of the
// role-based permission system (DmsRolePermission). Exactly one of
// FolderId/DocumentId is set. A folder-scoped override cascades to every
// subfolder and file inside it unless a more specific override exists
// further down the tree. Each action flag is a tri-state: null means "no
// opinion, fall back to the role", true means "allow", false means "deny".
// See AccessOverrideService for the deny-always-wins + direct-beats-group
// resolution algorithm.
//
// The Folder Permissions modal shows two grouped sections for a folder-scoped
// override — "Folder Level Permissions" (Read/Write/Rename/Copy/Cut/
// DownloadZip/CreateSubfolder/Delete, governing the folder object itself) and
// "File Level Permissions" (FileRead/FileCopy/FileCut/FileRename/Unlock/Write/
// UploadUpdatedFile/SubmitForApproval/Download/DownloadForEditing/FileDelete,
// cascading to every file inside it) — both saved on the same row. The
// standalone File Permissions modal for one document only shows the File
// Level section.
// Read/Rename/Copy/Cut are deliberately split into folder-scope and
// file-scope columns (e.g. Read vs FileRead) since "can see this folder
// exists" and "can open the files inside it" are genuinely different
// questions — sharing one column would make the two toggles not actually
// independent. Write is deliberately NOT split — Folder Level "Write" and
// File Level "Upload" are the same real capability by explicit design choice.
public class DmsAccessOverride
{
    public Guid OverrideId { get; set; }
    public Guid? FolderId { get; set; }
    public Guid? DocumentId { get; set; }
    public string TargetType { get; set; } = string.Empty; // "User" | "Group"
    public Guid TargetId { get; set; }

    // Folder-scope.
    public bool? Read { get; set; }
    public bool? Write { get; set; }
    public bool? Rename { get; set; }
    public bool? Copy { get; set; }
    public bool? Cut { get; set; }
    public bool? DownloadZip { get; set; }
    public bool? CreateSubfolder { get; set; }
    public bool? Delete { get; set; }

    // File-scope.
    public bool? FileRead { get; set; }
    public bool? FileRename { get; set; }
    public bool? FileCopy { get; set; }
    public bool? FileCut { get; set; }
    public bool? Unlock { get; set; }
    public bool? SubmitForApproval { get; set; }
    public bool? Download { get; set; }
    public bool? DownloadForEditing { get; set; }
    public bool? UploadUpdatedFile { get; set; }
    public bool? FileDelete { get; set; }

    public Guid CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

// The actions a File/Folder Permission override can grant or deny.
public static class AccessOverrideActions
{
    public const string Read = "read";
    public const string Write = "write";
    public const string Rename = "rename";
    public const string Copy = "copy";
    public const string Cut = "cut";
    public const string DownloadZip = "download_zip";
    public const string CreateSubfolder = "create_subfolder";
    public const string Delete = "delete";

    public const string FileRead = "file_read";
    public const string FileRename = "file_rename";
    public const string FileCopy = "file_copy";
    public const string FileCut = "file_cut";
    public const string Unlock = "unlock";
    public const string SubmitForApproval = "submit_for_approval";
    public const string Download = "download";
    public const string DownloadForEditing = "download_for_editing";
    public const string UploadUpdatedFile = "upload_updated_file";
    public const string FileDelete = "file_delete";
}
