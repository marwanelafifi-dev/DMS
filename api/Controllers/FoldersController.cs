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
    private static readonly Guid DevSystemAdminId = Guid.Parse("00000000-0000-0000-0000-000000000001");
    private static readonly string[] FolderWriteRoles =
    [
        FolderRoles.Writer,
        FolderRoles.Manager,
        FolderRoles.QA,
        FolderRoles.Admin
    ];

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

            // التحقق من المدخلات
            if (string.IsNullOrWhiteSpace(req.Name))
                return BadRequest(new { success = false, error = "اسم المجلد مطلوب" });

            if (req.OwnerId == Guid.Empty)
                return BadRequest(new { success = false, error = "المالك مطلوب" });

            // Folder ownership is derived from the authenticated request. The API
            // does not permit callers to grant Admin access to an arbitrary user.
            if (req.OwnerId != userId)
                return StatusCode(403, new { success = false, error = "Folder owner must match the authenticated user" });

            // التحقق من وجود المالك
            var ownerExists = await context.Users
                .AnyAsync(u => u.UserId == userId && u.IsActive);

            if (!ownerExists)
                return BadRequest(new { success = false, error = "المالك غير موجود أو معطل" });

            var canCreateFolder = userId == DevSystemAdminId;

            // التحقق من المجلد الأب إن وجد
            if (req.ParentFolderId.HasValue)
            {
                var parentExists = await context.Folders
                    .AnyAsync(f => f.FolderId == req.ParentFolderId);

                if (!parentExists)
                    return BadRequest(new { success = false, error = "المجلد الأب غير موجود" });

                canCreateFolder = await context.FolderPermissions.AnyAsync(permission =>
                    permission.FolderId == req.ParentFolderId &&
                    permission.UserId == userId &&
                    FolderWriteRoles.Contains(permission.Role));
            }
            else if (!canCreateFolder)
            {
                canCreateFolder = await context.FolderPermissions.AnyAsync(permission =>
                    permission.UserId == userId &&
                    FolderWriteRoles.Contains(permission.Role));
            }

            if (!canCreateFolder)
                return StatusCode(403, new { success = false, error = "Writer permission is required to create a folder" });

            await using var transaction = await context.Database.BeginTransactionAsync();

            if (req.ReuseExisting)
            {
                var normalizedName = req.Name.Trim().ToLower();
                var lockKey = $"{userId:N}:{req.ParentFolderId?.ToString("N") ?? "root"}:{normalizedName}";
                await context.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT pg_advisory_xact_lock(hashtextextended({lockKey}, 0))");

                var existingFolder = await context.Folders
                    .FirstOrDefaultAsync(folder =>
                        folder.OwnerId == userId &&
                        folder.ParentFolderId == req.ParentFolderId &&
                        folder.Name.ToLower() == normalizedName);

                if (existingFolder != null)
                {
                    var existingOwnerPermission = await context.FolderPermissions
                        .FirstOrDefaultAsync(permission =>
                            permission.FolderId == existingFolder.FolderId &&
                            permission.UserId == userId);
                    var permissionChanged = false;

                    if (existingOwnerPermission == null)
                    {
                        existingOwnerPermission = CreateOwnerPermission(existingFolder.FolderId, userId, userId);
                        context.FolderPermissions.Add(existingOwnerPermission);
                        permissionChanged = true;
                    }
                    else if (existingOwnerPermission.Role != FolderRoles.Admin)
                    {
                        existingOwnerPermission.Role = FolderRoles.Admin;
                        existingOwnerPermission.GrantedAt = DateTime.UtcNow;
                        existingOwnerPermission.GrantedById = userId;
                        permissionChanged = true;
                    }

                    if (permissionChanged)
                    {
                        await context.SaveChangesAsync();
                        await auditService.LogAsync(userId, AuditActions.PERMISSION_GRANTED, new
                        {
                            existingOwnerPermission.PermissionId,
                            existingOwnerPermission.FolderId,
                            existingOwnerPermission.UserId,
                            existingOwnerPermission.Role,
                            existingOwnerPermission.GrantedAt,
                            AutomaticOwnerGrant = true
                        });
                    }

                    await transaction.CommitAsync();
                    return Ok(new
                    {
                        success = true,
                        data = new
                        {
                            existingFolder.FolderId,
                            existingFolder.Name,
                            existingFolder.Description,
                            existingFolder.OwnerId,
                            existingFolder.CreatedAt,
                            existingFolder.UpdatedAt,
                            Reused = true
                        }
                    });
                }
            }

            var folder = new DmsFolder
            {
                FolderId = Guid.NewGuid(),
                ParentFolderId = req.ParentFolderId,
                Name = req.Name.Trim(),
                Description = req.Description?.Trim(),
                Classification = req.Classification ?? "standard",
                OwnerId = userId,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            var ownerPermission = CreateOwnerPermission(folder.FolderId, userId, userId);

            context.Folders.Add(folder);
            context.FolderPermissions.Add(ownerPermission);
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, AuditActions.FOLDER_CREATED, new
            {
                folder.FolderId,
                folder.Name,
                folder.Classification,
                folder.OwnerId,
                folder.CreatedAt
            });
            await auditService.LogAsync(userId, AuditActions.PERMISSION_GRANTED, new
            {
                ownerPermission.PermissionId,
                ownerPermission.FolderId,
                ownerPermission.UserId,
                ownerPermission.Role,
                ownerPermission.GrantedAt,
                AutomaticOwnerGrant = true
            });
            await transaction.CommitAsync();

            logger.LogInformation("Created folder {FolderId} by user {OwnerId}", folder.FolderId, userId);

            return CreatedAtAction(nameof(GetFolder), new { id = folder.FolderId }, new
            {
                success = true,
                data = new
                {
                    folder.FolderId,
                    folder.Name,
                    folder.Description,
                    folder.OwnerId,
                    folder.CreatedAt,
                    folder.UpdatedAt,
                    Reused = false
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating folder");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    private static DmsFolderPermission CreateOwnerPermission(Guid folderId, Guid ownerId, Guid grantedById)
    {
        return new DmsFolderPermission
        {
            PermissionId = Guid.NewGuid(),
            FolderId = folderId,
            UserId = ownerId,
            Role = FolderRoles.Admin,
            GrantedAt = DateTime.UtcNow,
            GrantedById = grantedById
        };
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
    string? Classification = null,
    bool ReuseExisting = false
);

public record UpdateFolderRequest(
    string? Name = null,
    string? Description = null,
    string? Classification = null
);
