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
        // قراءة معلومات الـ request
        var method = context.Request.Method;
        var path = context.Request.Path.Value;

        // تخطي الـ endpoints التي لا تحتاج authorization (مثل health check, test)
        if (ShouldSkipAuth(path, method))
        {
            await _next(context);
            return;
        }

        // محاولة الحصول على userId من header
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

        // التحقق من أن المستخدم موجود ومفعّل
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

        // إضافة معلومات المستخدم إلى context
        context.Items["UserId"] = userId;
        context.Items["User"] = user;

        // التحقق من الصلاحيات بناءً على الـ endpoint والـ method
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
            "/api/databasetest"
        };

        return skipEndpoints.Any(endpoint => path.StartsWith(endpoint, StringComparison.OrdinalIgnoreCase));
    }

    private bool IsDocumentEndpoint(string path) => path.StartsWith("/api/documents", StringComparison.OrdinalIgnoreCase);
    private bool IsFolderEndpoint(string path) => path.StartsWith("/api/folders", StringComparison.OrdinalIgnoreCase);

    // يرجع true إذا تم التعامل مع الطلب بالفعل (لا تستدعي _next بعدها)
    private async Task<bool> CheckDocumentPermissions(HttpContext context, DmsContext dbContext, Guid userId, string method, string path)
    {
        // استخراج document ID من الـ path
        var segments = path.Split('/');
        if (segments.Length < 4 || !Guid.TryParse(segments[3], out var documentId))
        {
            // لا توجد document ID (مثل GET /api/documents) — اترك الكنترولر يتعامل معها
            return false;
        }

        // الحصول على المستند
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

        // الحصول على صلاحيات المستخدم على المجلد الذي فيه المستند
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

        // التحقق من الصلاحيات بناءً على الـ method
        if (!HasPermissionForMethod(method, permission.Role))
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

    // يرجع true إذا تم التعامل مع الطلب بالفعل (لا تستدعي _next بعدها)
    private async Task<bool> CheckFolderPermissions(HttpContext context, DmsContext dbContext, Guid userId, string method, string path)
    {
        // استخراج folder ID من الـ path
        var segments = path.Split('/');
        if (segments.Length < 4 || !Guid.TryParse(segments[3], out var folderId))
        {
            // إذا لا توجد folder ID (مثل GET /api/folders) — كل مستخدم يقدر يرى جميع المجلدات
            return false;
        }

        // الحصول على المجلد
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

        // الحصول على صلاحيات المستخدم
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

        // التحقق من الصلاحيات
        if (!HasPermissionForMethod(method, permission.Role))
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

    private bool HasPermissionForMethod(string method, string role)
    {
        return method.ToUpper() switch
        {
            "GET" => role is "Reader" or "Writer" or "Manager" or "QA" or "Admin",
            "POST" => role is "Writer" or "Manager" or "QA" or "Admin",
            "PUT" => role is "Manager" or "QA" or "Admin",
            "DELETE" => role is "Manager" or "Admin",
            _ => false
        };
    }
}
