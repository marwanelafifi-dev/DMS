using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Middleware;

public class RBACMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<RBACMiddleware> _logger;

    public RBACMiddleware(RequestDelegate next, ILogger<RBACMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context, DmsContext dbContext, AccessOverrideService accessOverrideService)
    {
        // Read request information
        var method = context.Request.Method;
        var path = context.Request.Path.Value;

        // Skip endpoints that don't need authorization (e.g. health check, test)
        if (ShouldSkipAuth(path, method))
        {
            await _next(context);
            return;
        }

        // Try to get userId from the header
        var userIdHeader = context.Request.Headers["X-User-Id"].ToString();

        if (string.IsNullOrEmpty(userIdHeader) || !Guid.TryParse(userIdHeader, out var userId))
        {
            _logger.LogWarning("Missing or invalid X-User-Id header");
            context.Response.StatusCode = 401;
            await context.Response.WriteAsJsonAsync(new
            {
                success = false,
                error = "Missing or invalid X-User-Id header"
            });
            return;
        }

        // Verify that the user exists and is active
        var user = await dbContext.Users
            .FirstOrDefaultAsync(u => u.UserId == userId && u.IsActive);

        if (user == null)
        {
            _logger.LogWarning("User {UserId} not found or inactive", userId);
            context.Response.StatusCode = 401;
            await context.Response.WriteAsJsonAsync(new
            {
                success = false,
                error = "User not found or inactive"
            });
            return;
        }

        // Add user information to the context
        context.Items["UserId"] = userId;
        context.Items["User"] = user;

        // Check permissions based on the endpoint and method
        if (IsDocumentEndpoint(path))
        {
            var handled = await CheckDocumentPermissions(context, dbContext, accessOverrideService, user, method, path);
            if (handled)
                return;
        }

        if (IsFolderEndpoint(path))
        {
            var handled = await CheckFolderPermissions(context, dbContext, accessOverrideService, user, method, path);
            if (handled)
                return;
        }

        await _next(context);
    }

    private bool ShouldSkipAuth(string path, string method)
    {
        var skipEndpoints = new[]
        {
            "/health",
            "/api/test",
            "/api/miniotest",
            "/api/databasetest",
            // No session token exists yet at login time.
            "/api/auth/login",
            "/api/auth/set-initial-password",
            // No session/X-User-Id exists yet at Google sign-in time either —
            // AuthController verifies the Google ID token itself instead.
            "/api/auth/google",
            // Google redirects the user's browser here directly after OAuth
            // consent — there is no X-User-Id header on that request. The user
            // is instead identified via the `state` query parameter, which
            // GoogleCalendarController validates itself (see the security note
            // in IGoogleOAuthCalendarClient.cs about hardening it).
            "/api/googlecalendar/callback",
            // Public read-only branding config/logo for the Login page.
            "/api/branding",
        };

        return skipEndpoints.Any(endpoint => path.StartsWith(endpoint, StringComparison.OrdinalIgnoreCase));
    }

    private bool IsDocumentEndpoint(string path) => path.StartsWith("/api/documents", StringComparison.OrdinalIgnoreCase);
    private bool IsFolderEndpoint(string path) => path.StartsWith("/api/folders", StringComparison.OrdinalIgnoreCase);

    // Returns true if the request has already been handled (don't call _next afterwards)
    private async Task<bool> CheckDocumentPermissions(HttpContext context, DmsContext dbContext, AccessOverrideService accessOverrideService, DmsUser user, string method, string path)
    {
        // Extract the document ID from the path
        var segments = path.Split('/');
        if (segments.Length < 4 || !Guid.TryParse(segments[3], out var documentId))
        {
            // No document ID present (e.g. GET /api/documents) — let the controller handle it
            return false;
        }

        // Get the document
        var document = await dbContext.Documents
            .FirstOrDefaultAsync(d => d.DocumentId == documentId);

        if (document == null)
        {
            context.Response.StatusCode = 404;
            await context.Response.WriteAsJsonAsync(new
            {
                success = false,
                error = "Document not found"
            });
            return true;
        }

        // Get the user's permissions on the folder containing the document
        var permission = await dbContext.FolderPermissions
            .FirstOrDefaultAsync(p => p.FolderId == document.FolderId && p.UserId == user.UserId);

        // A folder-specific grant always takes precedence; the user's global
        // role (dms_users.role) is page/feature access only and no longer a
        // folder-role fallback — except a role with BypassFolderPermissions
        // ("Full Access"), which acts as Admin everywhere.
        var effectiveRole = await ResolveEffectiveFolderRoleAsync(dbContext, permission, user);

        // POST /{id}/upload is used both to attach a brand-new document's
        // very first version (immediately after creation) and to replace an
        // existing version's content later (the checkout/edit/reupload
        // workflow) — those are two different real permissions. Gating the
        // first case on UploadUpdatedFile (meant for the second) meant an
        // Access Override that granted Write (enough for the document record
        // itself to be created) but not the separate UploadUpdatedFile action
        // left the new document permanently stuck with no file attached: the
        // row was created, then the very next call in the same upload flow
        // was rejected with a confusing "No permission" error.
        var isFirstVersionUpload = method.Equals("POST", StringComparison.OrdinalIgnoreCase)
            && path.EndsWith("/upload", StringComparison.OrdinalIgnoreCase)
            && !document.CurrentVersionId.HasValue;

        // With no role at all, there's nothing for a File Permission override
        // to layer on top of — a lone "allow" override with no role can't
        // grant access on its own in this pass (only role-holders get the
        // override treatment). This matches "override narrows or widens a
        // role's access", not "override is a substitute for having one".
        bool roleAllowed;
        string action;
        if (effectiveRole == null)
        {
            roleAllowed = false;
            action = ActionForMethod(method, path, isFolder: false, isFirstVersionUpload);
        }
        else
        {
            (roleAllowed, action) = await HasPermissionForMethodAsync(dbContext, method, path, effectiveRole, isFolder: false, isRootFolder: false, isFirstVersionUpload);
        }

        // Per explicit request, the task-assignee bypass that used to live here
        // (grant View/Download/DownloadForEditing/UploadUpdatedFile/checkout-
        // release on a document just because the caller has an open task
        // pointed at it, with zero real folder access) was removed entirely —
        // a task referencing a document is no longer, on its own, a reason to
        // be able to open it. The task's assignee now needs the exact same
        // real folder access (a role grant, a role-wide bypass flag, or an
        // Allow override) as anyone else browsing to it directly in the
        // Document Library. See GET /api/tasks/{id}/document for the matching
        // change on the metadata side.
        var finalAllowed = await accessOverrideService.ResolveAsync(user.UserId, documentId, document.FolderId, action, roleAllowed);

        if (!finalAllowed)
        {
            _logger.LogWarning("User {UserId} with role {Role} cannot {Method} document", user.UserId, effectiveRole, method);
            context.Response.StatusCode = 403;
            await context.Response.WriteAsJsonAsync(new
            {
                success = false,
                error = effectiveRole == null ? "No permission to access this document" : $"Role '{effectiveRole}' cannot {method.ToLower()} documents"
            });
            return true;
        }

        context.Items["FolderId"] = document.FolderId;
        context.Items["DocumentId"] = documentId;
        context.Items["UserRole"] = effectiveRole;
        return false;
    }

    // Returns true if the request has already been handled (don't call _next afterwards)
    private async Task<bool> CheckFolderPermissions(HttpContext context, DmsContext dbContext, AccessOverrideService accessOverrideService, DmsUser user, string method, string path)
    {
        // Extract the folder ID from the path
        var segments = path.Split('/');
        if (segments.Length < 4 || !Guid.TryParse(segments[3], out var folderId))
        {
            // If there's no folder ID (e.g. GET /api/folders) — every user can see all folders
            return false;
        }

        // Get the folder
        var folder = await dbContext.Folders
            .FirstOrDefaultAsync(f => f.FolderId == folderId);

        if (folder == null)
        {
            context.Response.StatusCode = 404;
            await context.Response.WriteAsJsonAsync(new
            {
                success = false,
                error = "Folder not found"
            });
            return true;
        }

        // Get the user's permissions
        var permission = await dbContext.FolderPermissions
            .FirstOrDefaultAsync(p => p.FolderId == folderId && p.UserId == user.UserId);

        // Folder-specific grant wins; otherwise only a BypassFolderPermissions
        // ("Full Access") role acts as Admin here — the global role itself is
        // page/feature access only, not a folder-role fallback.
        var effectiveRole = await ResolveEffectiveFolderRoleAsync(dbContext, permission, user);

        bool roleAllowed;
        string action;
        if (effectiveRole == null)
        {
            roleAllowed = false;
            action = ActionForMethod(method, path, isFolder: true);
        }
        else
        {
            (roleAllowed, action) = await HasPermissionForMethodAsync(dbContext, method, path, effectiveRole, isFolder: true, isRootFolder: folder.ParentFolderId == null);
        }

        var finalAllowed = await accessOverrideService.ResolveAsync(user.UserId, null, folderId, action, roleAllowed);

        if (!finalAllowed)
        {
            _logger.LogWarning("User {UserId} with role {Role} cannot {Method} folder", user.UserId, effectiveRole, method);
            context.Response.StatusCode = 403;
            await context.Response.WriteAsJsonAsync(new
            {
                success = false,
                error = effectiveRole == null ? "No permission to access this folder" : $"Role '{effectiveRole}' cannot {method.ToLower()} folders"
            });
            return true;
        }

        context.Items["FolderId"] = folderId;
        context.Items["UserRole"] = effectiveRole;
        return false;
    }

    // A folder-specific grant always wins. With none, only a page-access role
    // whose BypassFolderPermissions flag is set ("Full Access") gets treated
    // as Admin — every other role has zero folder-content access by default,
    // matching "managed by each folder permission using users or groups".
    private static async Task<string?> ResolveEffectiveFolderRoleAsync(DmsContext dbContext, DmsFolderPermission? permission, DmsUser user)
    {
        if (permission != null)
            return permission.Role;

        if (user.Role == null)
            return null;

        var pageAccessRole = await dbContext.PageAccessRoles.FirstOrDefaultAsync(r => r.Role == user.Role);
        if (pageAccessRole?.BypassFolderPermissions == true) return FolderRoles.Admin;
        // "Read Folders Only" / "Read and Write Folders Only" — weaker, tiered
        // versions of the same bypass idea, capped at Reader/Writer instead
        // of Admin everywhere.
        if (pageAccessRole?.CanReadWriteAllFolders == true) return FolderRoles.Writer;
        if (pageAccessRole?.CanReadAllFolders == true) return FolderRoles.Reader;
        return null;
    }

    // Maps an HTTP method (+ path shape, + entity kind) to the File/Folder
    // Permission action name it corresponds to, independent of role lookup —
    // used both to resolve the role's default and to know which override
    // flag to check. Read/Rename/Delete are split by entity kind (Read vs
    // FileRead, Rename vs FileRename, Delete vs FileDelete) since "can see
    // this folder" and "can open/delete a file inside it" are different
    // questions — see DmsAccessOverride.
    private static string ActionForMethod(string method, string path, bool isFolder, bool isFirstVersionUpload = false) => method.ToUpper() switch
    {
        "GET" => path.Contains("/download", StringComparison.OrdinalIgnoreCase) ? AccessOverrideActions.Download
            : isFolder ? AccessOverrideActions.Read : AccessOverrideActions.FileRead,
        "POST" => path.EndsWith("/submit", StringComparison.OrdinalIgnoreCase) ? AccessOverrideActions.SubmitForApproval
            : path.EndsWith("/force-unlock", StringComparison.OrdinalIgnoreCase) ? AccessOverrideActions.Unlock
            : path.EndsWith("/upload", StringComparison.OrdinalIgnoreCase) ? (isFirstVersionUpload ? AccessOverrideActions.Write : AccessOverrideActions.UploadUpdatedFile)
            : AccessOverrideActions.Write,
        // Real bug found live: PUT /api/documents/{id} is the one generic
        // "update this document" endpoint — title/description/tags/category/
        // department/owner/fileName all go through it, and
        // DocumentsController.UpdateDocument's own internal check already
        // gates the whole thing on FileEdit, not FileRename (there is no
        // separate rename-only endpoint for documents). This middleware
        // used to gate the same request on FileRename instead — so a user
        // granted FileEdit=Allow (but not the separate FileRename) got
        // blocked by the middleware before the controller's own, correct
        // check ever ran, most visibly right after a real upload succeeded
        // (Upload New Version's own follow-up metadata PUT), which is what
        // made the whole operation look like it failed even though the file
        // itself had already gone through.
        "PUT" => isFolder ? AccessOverrideActions.Rename : AccessOverrideActions.FileEdit,
        "DELETE" => isFolder ? AccessOverrideActions.Delete : AccessOverrideActions.FileDelete,
        _ => "none" // no override support for anything else — role default only
    };

    // Reads the editable dms_role_permissions table (see RolePermissionsController)
    // instead of a hardcoded role list — editing a role's permissions on the Roles
    // admin page changes what actually happens here, not just what's displayed.
    // GET is split between "view" and "download" by path since both use the same
    // HTTP method. POST (creating a new document/folder) is gated by Upload; PUT
    // (editing an existing one) is split by entity kind into UpdateFile/UpdateFolder
    // so those can be granted independently. DownloadForEditing is a distinct,
    // separately-tracked flag for downloading the real/original file (vs. the
    // read-only copy covered by DownloadReadOnly); it isn't wired to a distinct
    // download route yet since the API only has one document-download endpoint
    // today. DELETE is split by entity kind: a document delete always checks
    // DeleteFile; a folder delete checks DeleteParentFolder or DeleteSubfolder
    // depending on whether it has a parent. Folder/task *creation* has no ID in
    // the path yet (nothing to look up here), so CreateSubfolder/CreateParentFolder/
    // AddTask are instead checked directly in FoldersController/TasksController.
    //
    // Returns (roleAllows, action) — action is the File/Folder Permission
    // override key this request maps to, resolved by the caller against
    // AccessOverrideService alongside the role's own default.
    private async Task<(bool RoleAllows, string Action)> HasPermissionForMethodAsync(DmsContext dbContext, string method, string path, string role, bool isFolder, bool isRootFolder, bool isFirstVersionUpload = false)
    {
        var action = ActionForMethod(method, path, isFolder, isFirstVersionUpload);
        var permission = await dbContext.RolePermissions.FirstOrDefaultAsync(rp => rp.Role == role);
        if (permission == null)
        {
            _logger.LogWarning("No role permission row found for role {Role} — denying by default", role);
            return (false, action);
        }

        var allowed = method.ToUpper() switch
        {
            "GET" => path.Contains("/download", StringComparison.OrdinalIgnoreCase) ? permission.DownloadReadOnly : permission.ViewOnly,
            "POST" => path.EndsWith("/submit", StringComparison.OrdinalIgnoreCase) ? permission.SubmitForApproval
                : path.EndsWith("/force-unlock", StringComparison.OrdinalIgnoreCase) ? permission.AdminForceUnlock
                : permission.Upload,
            "PUT" => isFolder ? permission.UpdateFolder : permission.UpdateFile,
            "DELETE" => isFolder ? (isRootFolder ? permission.DeleteParentFolder : permission.DeleteSubfolder) : permission.DeleteFile,
            _ => false
        };

        return (allowed, action);
    }
}
