using DMS.Api.Data;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

// Editable, enforced permission flags for the fixed folder-permission roles
// (Reader/Writer/Manager/QA/Admin) — RBACMiddleware reads this table to decide
// what a role can actually do; editing here changes real access, not just
// what's displayed on the Roles page.
[ApiController]
[Route("api/role-permissions")]
public class RolePermissionsController(DmsContext context, AuditService auditService, ILogger<RolePermissionsController> logger) : BaseController
{
    private static readonly string[] EditableRoles = { "Writer", "Manager", "QA", "Admin" };

    [HttpGet]
    public async Task<ActionResult<object>> GetRolePermissions()
    {
        try
        {
            var permissions = await context.RolePermissions
                .OrderBy(rp => rp.Role)
                .Select(rp => new
                {
                    rp.Role,
                    rp.ViewOnly,
                    rp.DownloadReadOnly,
                    rp.Upload,
                    rp.UpdatePermission,
                    rp.Approve,
                    rp.Reject,
                    rp.AdminForceUnlock,
                    rp.UpdatedAt,
                })
                .ToListAsync();

            return Ok(new { success = true, data = permissions, count = permissions.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving role permissions");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    [HttpPut("{role}")]
    public async Task<ActionResult<object>> UpdateRolePermission(string role, [FromBody] UpdateRolePermissionRequest req)
    {
        try
        {
            if (!EditableRoles.Contains(role))
                return BadRequest(new { success = false, error = "This role's permissions can't be edited" });

            var permission = await context.RolePermissions.FirstOrDefaultAsync(rp => rp.Role == role);
            if (permission == null)
                return NotFound(new { success = false, error = "Role not found" });

            permission.ViewOnly = req.ViewOnly;
            permission.DownloadReadOnly = req.DownloadReadOnly;
            permission.Upload = req.Upload;
            permission.UpdatePermission = req.UpdatePermission;
            permission.Approve = req.Approve;
            permission.Reject = req.Reject;
            permission.AdminForceUnlock = req.AdminForceUnlock;
            permission.UpdatedAt = DateTime.UtcNow;

            await context.SaveChangesAsync();

            await auditService.LogAsync(GetCurrentUserId(), ROLE_PERMISSIONS_UPDATED, new
            {
                permission.Role,
                permission.ViewOnly,
                permission.DownloadReadOnly,
                permission.Upload,
                permission.UpdatePermission,
                permission.Approve,
                permission.Reject,
                permission.AdminForceUnlock,
            });

            logger.LogInformation("Updated role permissions for {Role}", role);

            return Ok(new
            {
                success = true,
                data = new
                {
                    permission.Role,
                    permission.ViewOnly,
                    permission.DownloadReadOnly,
                    permission.Upload,
                    permission.UpdatePermission,
                    permission.Approve,
                    permission.Reject,
                    permission.AdminForceUnlock,
                    permission.UpdatedAt,
                },
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error updating role permissions for {Role}", role);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}

public record UpdateRolePermissionRequest(bool ViewOnly, bool DownloadReadOnly, bool Upload, bool UpdatePermission, bool Approve, bool Reject, bool AdminForceUnlock);
