using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

// A user's global role — page/feature visibility only (Dashboard, Document
// Library, Approvals, PCAR, Admin Panel, Reminders), plus the one
// "BypassFolderPermissions" super-admin flag. File/folder actions
// (upload/delete/rename/download/...) are governed entirely by per-folder
// grants and File/Folder Permission overrides, never by this table — see
// BaseController.GetEffectiveRoleAsync and RBACMiddleware for where that
// split is enforced.
[ApiController]
[Route("api/page-access-roles")]
public class PageAccessRolesController(DmsContext context, AuditService auditService, ILogger<PageAccessRolesController> logger) : BaseController
{
    // The 5 built-in roles can never be deleted or renamed away — the Users
    // page's Access selector and this controller both assume they always exist.
    private static readonly string[] BuiltInRoles = ["User", "Manager", "Quality", "Auditor", "Full Access"];
    private static bool IsBuiltInRole(string role) => BuiltInRoles.Contains(role);

    [HttpGet]
    public async Task<ActionResult<object>> GetPageAccessRoles()
    {
        try
        {
            var roles = await context.PageAccessRoles
                .OrderBy(r => r.Role)
                .ToListAsync();

            return Ok(new { success = true, data = roles, count = roles.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving page access roles");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/page-access-roles — create a new, fully custom role
    [HttpPost]
    public async Task<ActionResult<object>> CreatePageAccessRole([FromBody] CreatePageAccessRoleRequest req)
    {
        try
        {
            var role = req.Role?.Trim() ?? string.Empty;
            if (role.Length < 2 || role.Length > 50)
                return BadRequest(new { success = false, error = "Role name must be between 2 and 50 characters" });

            if (await context.PageAccessRoles.AnyAsync(r => r.Role == role))
                return BadRequest(new { success = false, error = $"A role named '{role}' already exists" });

            var entity = new DmsPageAccessRole
            {
                Role = role,
                CanViewDashboard = req.CanViewDashboard,
                CanViewDocumentLibrary = req.CanViewDocumentLibrary,
                CanViewReminders = req.CanViewReminders,
                CanViewApprovals = req.CanViewApprovals,
                CanViewPcar = req.CanViewPcar,
                CanViewAdminPanel = req.CanViewAdminPanel,
                BypassFolderPermissions = req.BypassFolderPermissions,
                UpdatedAt = DateTime.UtcNow,
            };

            context.PageAccessRoles.Add(entity);
            await context.SaveChangesAsync();

            await auditService.LogAsync(GetCurrentUserId(), ROLE_CREATED, entity);

            logger.LogInformation("Created page access role {Role}", role);

            return CreatedAtAction(nameof(GetPageAccessRoles), new { success = true, data = entity });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating page access role");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    [HttpPut("{role}")]
    public async Task<ActionResult<object>> UpdatePageAccessRole(string role, [FromBody] UpdatePageAccessRoleRequest req)
    {
        try
        {
            var entity = await context.PageAccessRoles.FirstOrDefaultAsync(r => r.Role == role);
            if (entity == null)
                return NotFound(new { success = false, error = "Role not found" });

            entity.CanViewDashboard = req.CanViewDashboard;
            entity.CanViewDocumentLibrary = req.CanViewDocumentLibrary;
            entity.CanViewReminders = req.CanViewReminders;
            entity.CanViewApprovals = req.CanViewApprovals;
            entity.CanViewPcar = req.CanViewPcar;
            entity.CanViewAdminPanel = req.CanViewAdminPanel;
            entity.BypassFolderPermissions = req.BypassFolderPermissions;
            entity.UpdatedAt = DateTime.UtcNow;

            await context.SaveChangesAsync();

            await auditService.LogAsync(GetCurrentUserId(), ROLE_PERMISSIONS_UPDATED, entity);

            logger.LogInformation("Updated page access role {Role}", role);

            return Ok(new { success = true, data = entity });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error updating page access role {Role}", role);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/page-access-roles/{role} — delete a custom role
    [HttpDelete("{role}")]
    public async Task<ActionResult<object>> DeletePageAccessRole(string role)
    {
        try
        {
            if (IsBuiltInRole(role))
                return BadRequest(new { success = false, error = $"'{role}' is a built-in role and can't be deleted" });

            var entity = await context.PageAccessRoles.FirstOrDefaultAsync(r => r.Role == role);
            if (entity == null)
                return NotFound(new { success = false, error = "Role not found" });

            var affectedUserCount = await context.Users.CountAsync(u => u.Role == role);

            context.PageAccessRoles.Remove(entity);
            await context.SaveChangesAsync();

            await auditService.LogAsync(GetCurrentUserId(), ROLE_DELETED, new { Role = role, AffectedUserCount = affectedUserCount });

            logger.LogInformation("Deleted page access role {Role} ({AffectedUserCount} users reset to No Access)", role, affectedUserCount);

            return Ok(new { success = true, message = affectedUserCount > 0 ? $"Role deleted. {affectedUserCount} user(s) reset to No Access." : "Role deleted." });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting page access role {Role}", role);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }
}

public record UpdatePageAccessRoleRequest(
    bool CanViewDashboard, bool CanViewDocumentLibrary, bool CanViewReminders,
    bool CanViewApprovals, bool CanViewPcar, bool CanViewAdminPanel, bool BypassFolderPermissions);

public record CreatePageAccessRoleRequest(
    string Role,
    bool CanViewDashboard, bool CanViewDocumentLibrary, bool CanViewReminders,
    bool CanViewApprovals, bool CanViewPcar, bool CanViewAdminPanel, bool BypassFolderPermissions);
