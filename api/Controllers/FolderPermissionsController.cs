using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class FolderPermissionsController(DmsContext context, AuditService auditService, ILogger<FolderPermissionsController> logger) : BaseController
{
    // GET /api/folderpermissions/folder/{folderId} — صلاحيات المجلد
    [HttpGet("folder/{folderId}")]
    public async Task<ActionResult<object>> GetFolderPermissions(Guid folderId)
    {
        try
        {
            var folder = await context.Folders.FirstOrDefaultAsync(f => f.FolderId == folderId);
            if (folder == null)
                return NotFound(new { success = false, error = "المجلد غير موجود" });

            var permissions = await context.FolderPermissions
                .Where(p => p.FolderId == folderId)
                .Select(p => new
                {
                    p.PermissionId,
                    p.FolderId,
                    p.UserId,
                    User = p.User == null ? null : new { p.User.UserId, p.User.FullName, p.User.Email },
                    p.Role,
                    p.GrantedAt,
                    GrantedBy = p.GrantedBy == null ? null : new { p.GrantedBy.UserId, p.GrantedBy.FullName }
                })
                .ToListAsync();

            logger.LogInformation("Retrieved {Count} permissions for folder {FolderId}", permissions.Count, folderId);

            return Ok(new { success = true, data = permissions, count = permissions.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving folder permissions");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/folderpermissions/user/{userId} — صلاحيات المستخدم
    [HttpGet("user/{userId}")]
    public async Task<ActionResult<object>> GetUserPermissions(Guid userId)
    {
        try
        {
            var permissions = await context.FolderPermissions
                .Where(p => p.UserId == userId)
                .Select(p => new
                {
                    p.PermissionId,
                    p.FolderId,
                    Folder = p.Folder == null ? null : new { p.Folder.FolderId, p.Folder.Name },
                    p.Role,
                    p.GrantedAt
                })
                .ToListAsync();

            logger.LogInformation("Retrieved {Count} permissions for user {UserId}", permissions.Count, userId);

            return Ok(new { success = true, data = permissions, count = permissions.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving user permissions");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/folderpermissions — منح صلاحية
    [HttpPost]
    public async Task<ActionResult<object>> GrantPermission([FromBody] GrantPermissionRequest req)
    {
        try
        {
            if (!FolderRoles.IsValid(req.Role))
                return BadRequest(new { success = false, error = $"Role must be one of: {string.Join(", ", FolderRoles.All)}" });

            var grantedBy = GetCurrentUserId();

            var folder = await context.Folders.FirstOrDefaultAsync(f => f.FolderId == req.FolderId);
            if (folder == null)
                return NotFound(new { success = false, error = "المجلد غير موجود" });

            var user = await context.Users.FirstOrDefaultAsync(u => u.UserId == req.UserId && u.IsActive);
            if (user == null)
                return NotFound(new { success = false, error = "المستخدم غير موجود أو معطل" });

            var existing = await context.FolderPermissions
                .FirstOrDefaultAsync(p => p.FolderId == req.FolderId && p.UserId == req.UserId);

            if (existing != null)
                return BadRequest(new { success = false, error = "المستخدم لديه صلاحية بالفعل" });

            var permission = new DmsFolderPermission
            {
                PermissionId = Guid.NewGuid(),
                FolderId = req.FolderId,
                UserId = req.UserId,
                Role = req.Role,
                GrantedAt = DateTime.UtcNow,
                GrantedById = grantedBy
            };

            context.FolderPermissions.Add(permission);
            await context.SaveChangesAsync();

            await auditService.LogAsync(grantedBy, PERMISSION_GRANTED, new
            {
                permission.PermissionId,
                permission.FolderId,
                permission.UserId,
                permission.Role,
                permission.GrantedAt,
                GrantedToName = user.FullName
            });

            logger.LogInformation("Granted {Role} permission to user {UserId} on folder {FolderId}", req.Role, req.UserId, req.FolderId);

            return Ok(new
            {
                success = true,
                data = new
                {
                    permission.PermissionId,
                    permission.FolderId,
                    permission.UserId,
                    permission.Role,
                    permission.GrantedAt
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error granting permission");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/folderpermissions/{id} — إلغاء صلاحية
    [HttpDelete("{id}")]
    public async Task<ActionResult<object>> RevokePermission(Guid id)
    {
        try
        {
            var revokedBy = GetCurrentUserId();
            var permission = await context.FolderPermissions.FirstOrDefaultAsync(p => p.PermissionId == id);

            if (permission == null)
                return NotFound(new { success = false, error = "الصلاحية غير موجودة" });

            var user = await context.Users.FirstOrDefaultAsync(u => u.UserId == permission.UserId);

            context.FolderPermissions.Remove(permission);
            await context.SaveChangesAsync();

            await auditService.LogAsync(revokedBy, PERMISSION_REVOKED, new
            {
                permission.PermissionId,
                permission.FolderId,
                permission.UserId,
                permission.Role,
                RevokedAt = DateTime.UtcNow,
                RevokedFromName = user?.FullName
            });

            logger.LogInformation("Revoked permission {PermissionId} from user {UserId}", id, permission.UserId);

            return Ok(new { success = true, message = "تم إلغاء الصلاحية بنجاح" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error revoking permission");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}

public record GrantPermissionRequest(
    Guid FolderId,
    Guid UserId,
    string Role // Reader, Writer, Manager, QA, Admin
);
