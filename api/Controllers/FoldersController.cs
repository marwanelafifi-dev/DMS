using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class FoldersController(DmsContext context, AuditService auditService, ILogger<FoldersController> logger) : BaseController
{
    // GET /api/folders — قائمة جميع المجلدات
    [HttpGet]
    public async Task<ActionResult<IEnumerable<object>>> GetFolders()
    {
        try
        {
            var folders = await context.Folders
                .Select(f => new
                {
                    f.FolderId,
                    f.Name,
                    f.Description,
                    f.Classification,
                    f.ParentFolderId,
                    f.OwnerId,
                    f.CreatedAt,
                    f.UpdatedAt
                })
                .OrderBy(f => f.Name)
                .ToListAsync();

            logger.LogInformation("Retrieved {Count} folders", folders.Count);
            return Ok(new { success = true, data = folders, count = folders.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving folders");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/folders/{id} — تفاصيل مجلد واحد
    [HttpGet("{id}")]
    public async Task<ActionResult<object>> GetFolder(Guid id)
    {
        try
        {
            var folder = await context.Folders
                .FirstOrDefaultAsync(f => f.FolderId == id);

            if (folder == null)
                return NotFound(new { success = false, error = "المجلد غير موجود" });

            var permissions = await context.FolderPermissions
                .Where(p => p.FolderId == id)
                .Select(p => new { p.PermissionId, p.UserId, p.Role, p.GrantedAt })
                .ToListAsync();

            var documentCount = await context.Documents
                .Where(d => d.FolderId == id)
                .CountAsync();

            logger.LogInformation("Retrieved folder {FolderId}", id);
            return Ok(new
            {
                success = true,
                data = new
                {
                    folder.FolderId,
                    folder.Name,
                    folder.Description,
                    folder.Classification,
                    folder.ParentFolderId,
                    folder.OwnerId,
                    folder.CreatedAt,
                    folder.UpdatedAt,
                    Permissions = permissions,
                    DocumentCount = documentCount
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving folder {FolderId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/folders — إنشاء مجلد جديد
    [HttpPost]
    public async Task<ActionResult<object>> CreateFolder([FromBody] CreateFolderRequest req)
    {
        try
        {
            var userId = GetCurrentUserId();
            var userRole = GetUserRole();

            // التحقق من المدخلات
            if (string.IsNullOrWhiteSpace(req.Name))
                return BadRequest(new { success = false, error = "اسم المجلد مطلوب" });

            if (req.OwnerId == Guid.Empty)
                return BadRequest(new { success = false, error = "المالك مطلوب" });

            // التحقق من وجود المالك
            var ownerExists = await context.Users
                .AnyAsync(u => u.UserId == req.OwnerId && u.IsActive);

            if (!ownerExists)
                return BadRequest(new { success = false, error = "المالك غير موجود أو معطل" });

            // التحقق من المجلد الأب إن وجد
            if (req.ParentFolderId.HasValue)
            {
                var parentExists = await context.Folders
                    .AnyAsync(f => f.FolderId == req.ParentFolderId);

                if (!parentExists)
                    return BadRequest(new { success = false, error = "المجلد الأب غير موجود" });
            }

            var folder = new DmsFolder
            {
                FolderId = Guid.NewGuid(),
                ParentFolderId = req.ParentFolderId,
                Name = req.Name.Trim(),
                Description = req.Description?.Trim(),
                Classification = req.Classification ?? "standard",
                OwnerId = req.OwnerId,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };

            context.Folders.Add(folder);
            await context.SaveChangesAsync();

            var currentUserId = GetCurrentUserId();
            await auditService.LogAsync(currentUserId, AuditActions.FOLDER_CREATED, new
            {
                folder.FolderId,
                folder.Name,
                folder.Classification,
                folder.OwnerId,
                folder.CreatedAt
            });

            logger.LogInformation("Created folder {FolderId} by user {OwnerId}", folder.FolderId, req.OwnerId);

            return CreatedAtAction(nameof(GetFolder), new { id = folder.FolderId }, new
            {
                success = true,
                data = new
                {
                    folder.FolderId,
                    folder.Name,
                    folder.CreatedAt
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating folder");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // PUT /api/folders/{id} — تعديل مجلد
    [HttpPut("{id}")]
    public async Task<ActionResult<object>> UpdateFolder(Guid id, [FromBody] UpdateFolderRequest req)
    {
        try
        {
            var folder = await context.Folders
                .FirstOrDefaultAsync(f => f.FolderId == id);

            if (folder == null)
                return NotFound(new { success = false, error = "المجلد غير موجود" });

            // تحديث الحقول
            if (!string.IsNullOrWhiteSpace(req.Name))
                folder.Name = req.Name.Trim();

            if (req.Description != null)
                folder.Description = req.Description.Trim();

            if (!string.IsNullOrWhiteSpace(req.Classification))
                folder.Classification = req.Classification;

            folder.UpdatedAt = DateTime.UtcNow;

            context.Folders.Update(folder);
            await context.SaveChangesAsync();

            var currentUserId = GetCurrentUserId();
            await auditService.LogAsync(currentUserId, AuditActions.FOLDER_UPDATED, new
            {
                folder.FolderId,
                folder.Name,
                folder.Classification,
                folder.UpdatedAt,
                ChangedFields = req
            });

            logger.LogInformation("Updated folder {FolderId}", id);

            return Ok(new
            {
                success = true,
                data = new
                {
                    folder.FolderId,
                    folder.Name,
                    folder.Classification,
                    folder.UpdatedAt
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error updating folder {FolderId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/folders/{id} — حذف مجلد
    [HttpDelete("{id}")]
    public async Task<ActionResult<object>> DeleteFolder(Guid id)
    {
        try
        {
            var folder = await context.Folders
                .FirstOrDefaultAsync(f => f.FolderId == id);

            if (folder == null)
                return NotFound(new { success = false, error = "المجلد غير موجود" });

            // التحقق من عدم وجود مستندات
            var documentCount = await context.Documents
                .Where(d => d.FolderId == id)
                .CountAsync();

            if (documentCount > 0)
                return BadRequest(new
                {
                    success = false,
                    error = $"لا يمكن حذف المجلد - يحتوي على {documentCount} مستندات"
                });

            // حذف الصلاحيات أولاً
            var permissions = await context.FolderPermissions
                .Where(p => p.FolderId == id)
                .ToListAsync();

            context.FolderPermissions.RemoveRange(permissions);

            // حذف المجلد
            context.Folders.Remove(folder);
            await context.SaveChangesAsync();

            var currentUserId = GetCurrentUserId();
            await auditService.LogAsync(currentUserId, AuditActions.FOLDER_DELETED, new
            {
                folder.FolderId,
                folder.Name,
                folder.Classification,
                DeletedAt = DateTime.UtcNow
            });

            logger.LogInformation("Deleted folder {FolderId}", id);

            return Ok(new { success = true, message = "تم حذف المجلد بنجاح" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting folder {FolderId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}

public record CreateFolderRequest(
    string Name,
    Guid OwnerId,
    Guid? ParentFolderId = null,
    string? Description = null,
    string? Classification = null
);

public record UpdateFolderRequest(
    string? Name = null,
    string? Description = null,
    string? Classification = null
);
