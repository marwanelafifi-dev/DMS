using DMS.Api.Data;
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

    public async Task InvokeAsync(HttpContext context, DmsContext dbContext)
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
            var handled = await CheckDocumentPermissions(context, dbContext, userId, method, path);
            if (handled)
                return;
        }

        if (IsFolderEndpoint(path))
        {
            var handled = await CheckFolderPermissions(context, dbContext, userId, method, path);
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
        };

        return skipEndpoints.Any(endpoint => path.StartsWith(endpoint, StringComparison.OrdinalIgnoreCase));
    }

    private bool IsDocumentEndpoint(string path) => path.StartsWith("/api/documents", StringComparison.OrdinalIgnoreCase);
    private bool IsFolderEndpoint(string path) => path.StartsWith("/api/folders", StringComparison.OrdinalIgnoreCase);

    // Returns true if the request has already been handled (don't call _next afterwards)
    private async Task<bool> CheckDocumentPermissions(HttpContext context, DmsContext dbContext, Guid userId, string method, string path)
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
            .FirstOrDefaultAsync(p => p.FolderId == document.FolderId && p.UserId == userId);

        if (permission == null)
        {
            _logger.LogWarning("User {UserId} has no permission on folder {FolderId}", userId, document.FolderId);
            context.Response.StatusCode = 403;
            await context.Response.WriteAsJsonAsync(new
            {
                success = false,
                error = "No permission to access this document"
            });
            return true;
        }

        // Check permissions based on the method
        if (!await HasPermissionForMethodAsync(dbContext, method, path, permission.Role))
        {
            _logger.LogWarning("User {UserId} with role {Role} cannot {Method} document", userId, permission.Role, method);
            context.Response.StatusCode = 403;
            await context.Response.WriteAsJsonAsync(new
            {
                success = false,
                error = $"Role '{permission.Role}' cannot {method.ToLower()} documents"
            });
            return true;
        }

        context.Items["FolderId"] = document.FolderId;
        context.Items["DocumentId"] = documentId;
        context.Items["UserRole"] = permission.Role;
        return false;
    }

    // Returns true if the request has already been handled (don't call _next afterwards)
    private async Task<bool> CheckFolderPermissions(HttpContext context, DmsContext dbContext, Guid userId, string method, string path)
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
            .FirstOrDefaultAsync(p => p.FolderId == folderId && p.UserId == userId);

        if (permission == null)
        {
            _logger.LogWarning("User {UserId} has no permission on folder {FolderId}", userId, folderId);
            context.Response.StatusCode = 403;
            await context.Response.WriteAsJsonAsync(new
            {
                success = false,
                error = "No permission to access this folder"
            });
            return true;
        }

        // Check permissions
        if (!await HasPermissionForMethodAsync(dbContext, method, path, permission.Role))
        {
            _logger.LogWarning("User {UserId} with role {Role} cannot {Method} folder", userId, permission.Role, method);
            context.Response.StatusCode = 403;
            await context.Response.WriteAsJsonAsync(new
            {
                success = false,
                error = $"Role '{permission.Role}' cannot {method.ToLower()} folders"
            });
            return true;
        }

        context.Items["FolderId"] = folderId;
        context.Items["UserRole"] = permission.Role;
        return false;
    }

    // Reads the editable dms_role_permissions table (see RolePermissionsController)
    // instead of a hardcoded role list — editing a role's permissions on the Roles
    // admin page changes what actually happens here, not just what's displayed.
    // GET is split between "view" and "download" by path since both use the same
    // HTTP method.
    private async Task<bool> HasPermissionForMethodAsync(DmsContext dbContext, string method, string path, string role)
    {
        var permission = await dbContext.RolePermissions.FirstOrDefaultAsync(rp => rp.Role == role);
        if (permission == null)
        {
            _logger.LogWarning("No role permission row found for role {Role} — denying by default", role);
            return false;
        }

        return method.ToUpper() switch
        {
            "GET" => path.Contains("/download", StringComparison.OrdinalIgnoreCase) ? permission.DownloadReadOnly : permission.ViewOnly,
            "POST" => permission.Upload,
            "PUT" => permission.UpdatePermission,
            "DELETE" => permission.AdminForceUnlock,
            _ => false
        };
    }
}
