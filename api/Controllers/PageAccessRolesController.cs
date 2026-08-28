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
                CanReadAllFolders = req.CanReadAllFolders,
                CanReadWriteAllFolders = req.CanReadWriteAllFolders,
                CanEditFiles = req.CanEditFiles,
                CanManageFolderPermissions = req.CanManageFolderPermissions,
                CanManageFilePermissions = req.CanManageFilePermissions,
                CanManageAllTasks = req.CanManageAllTasks,
                CanCreateTasks = req.CanCreateTasks,
                CanReassignTasks = req.CanReassignTasks,
                CanReassignMyTasks = req.CanReassignMyTasks,
                CanViewQaStage = req.CanViewQaStage,
                CanViewManagerStage = req.CanViewManagerStage,
                CanViewFinalReleaseStage = req.CanViewFinalReleaseStage,
                CanApprove = req.CanApprove,
                CanReject = req.CanReject,
                CanResolveDocumentId = req.CanResolveDocumentId,
                CanSendAnnouncements = req.CanSendAnnouncements,
                CanDeleteReminders = req.CanDeleteReminders,
                CanDeleteDocumentVersions = req.CanDeleteDocumentVersions,
                CanManageBulkActions = req.CanManageBulkActions,
                IsBuiltIn = false,
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
            entity.CanReadAllFolders = req.CanReadAllFolders;
            entity.CanReadWriteAllFolders = req.CanReadWriteAllFolders;
            entity.CanEditFiles = req.CanEditFiles;
            entity.CanManageFolderPermissions = req.CanManageFolderPermissions;
            entity.CanManageFilePermissions = req.CanManageFilePermissions;
            entity.CanManageAllTasks = req.CanManageAllTasks;
            entity.CanCreateTasks = req.CanCreateTasks;
            entity.CanReassignTasks = req.CanReassignTasks;
            entity.CanReassignMyTasks = req.CanReassignMyTasks;
            entity.CanViewQaStage = req.CanViewQaStage;
            entity.CanViewManagerStage = req.CanViewManagerStage;
            entity.CanViewFinalReleaseStage = req.CanViewFinalReleaseStage;
            entity.CanApprove = req.CanApprove;
            entity.CanReject = req.CanReject;
            entity.CanResolveDocumentId = req.CanResolveDocumentId;
            entity.CanSendAnnouncements = req.CanSendAnnouncements;
            entity.CanDeleteReminders = req.CanDeleteReminders;
            entity.CanDeleteDocumentVersions = req.CanDeleteDocumentVersions;
            entity.CanManageBulkActions = req.CanManageBulkActions;
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

    // PUT /api/page-access-roles/{role}/rename — rename any role, including the
    // 5 built-in ones. Safe to do: every real permission check (BaseController,
    // RBACMiddleware) keys off the BypassFolderPermissions boolean flag, never
    // the literal role name, so "Full Access" etc. carry no special string
    // significance outside this controller's own delete-protection list.
    [HttpPut("{role}/rename")]
    public async Task<ActionResult<object>> RenamePageAccessRole(string role, [FromBody] RenamePageAccessRoleRequest req)
    {
        var newRole = req.NewRole?.Trim() ?? string.Empty;
        if (newRole.Length < 2 || newRole.Length > 50)
            return BadRequest(new { success = false, error = "Role name must be between 2 and 50 characters" });

        await using var transaction = await context.Database.BeginTransactionAsync();
        try
        {
            var entity = await context.PageAccessRoles.FirstOrDefaultAsync(r => r.Role == role);
            if (entity == null)
                return NotFound(new { success = false, error = "Role not found" });

            if (newRole != role && await context.PageAccessRoles.AnyAsync(r => r.Role == newRole))
                return BadRequest(new { success = false, error = $"A role named '{newRole}' already exists" });

            if (newRole == role)
                return Ok(new { success = true, data = entity });

            // Role is the primary key referenced by dms_users.role via an FK
            // with no ON UPDATE CASCADE, so the new row has to exist before
            // reassigning users, and the old row can only go away once nothing
            // points at it anymore.
            var renamed = new DmsPageAccessRole
            {
                Role = newRole,
                CanViewDashboard = entity.CanViewDashboard,
                CanViewDocumentLibrary = entity.CanViewDocumentLibrary,
                CanViewReminders = entity.CanViewReminders,
                CanViewApprovals = entity.CanViewApprovals,
                CanViewPcar = entity.CanViewPcar,
                CanViewAdminPanel = entity.CanViewAdminPanel,
                BypassFolderPermissions = entity.BypassFolderPermissions,
                CanReadAllFolders = entity.CanReadAllFolders,
                CanReadWriteAllFolders = entity.CanReadWriteAllFolders,
                CanEditFiles = entity.CanEditFiles,
                CanManageFolderPermissions = entity.CanManageFolderPermissions,
                CanManageFilePermissions = entity.CanManageFilePermissions,
                CanManageAllTasks = entity.CanManageAllTasks,
                CanCreateTasks = entity.CanCreateTasks,
                CanReassignTasks = entity.CanReassignTasks,
                CanReassignMyTasks = entity.CanReassignMyTasks,
                CanViewQaStage = entity.CanViewQaStage,
                CanViewManagerStage = entity.CanViewManagerStage,
                CanViewFinalReleaseStage = entity.CanViewFinalReleaseStage,
                CanApprove = entity.CanApprove,
                CanReject = entity.CanReject,
                CanResolveDocumentId = entity.CanResolveDocumentId,
                CanSendAnnouncements = entity.CanSendAnnouncements,
                CanDeleteReminders = entity.CanDeleteReminders,
                CanDeleteDocumentVersions = entity.CanDeleteDocumentVersions,
                CanManageBulkActions = entity.CanManageBulkActions,
                IsBuiltIn = entity.IsBuiltIn,
                UpdatedAt = DateTime.UtcNow,
            };
            context.PageAccessRoles.Add(renamed);
            await context.SaveChangesAsync();

            var affectedUsers = await context.Users.Where(u => u.Role == role).ToListAsync();
            foreach (var user in affectedUsers)
                user.Role = newRole;

            context.PageAccessRoles.Remove(entity);
            await context.SaveChangesAsync();

            await transaction.CommitAsync();

            await auditService.LogAsync(GetCurrentUserId(), ROLE_RENAMED, new { OldRole = role, NewRole = newRole, AffectedUserCount = affectedUsers.Count });

            logger.LogInformation("Renamed page access role {OldRole} to {NewRole} ({AffectedUserCount} users updated)", role, newRole, affectedUsers.Count);

            return Ok(new { success = true, data = renamed });
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync();
            logger.LogError(ex, "Error renaming page access role {Role}", role);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/page-access-roles/{role} — delete a custom role
    [HttpDelete("{role}")]
    public async Task<ActionResult<object>> DeletePageAccessRole(string role)
    {
        try
        {
            var entity = await context.PageAccessRoles.FirstOrDefaultAsync(r => r.Role == role);
            if (entity == null)
                return NotFound(new { success = false, error = "Role not found" });

            if (entity.IsBuiltIn)
                return BadRequest(new { success = false, error = $"'{role}' is a built-in role and can't be deleted" });

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
    bool CanViewApprovals, bool CanViewPcar, bool CanViewAdminPanel, bool BypassFolderPermissions,
    bool CanReadAllFolders = false, bool CanReadWriteAllFolders = false,
    bool CanEditFiles = false, bool CanManageFolderPermissions = false, bool CanManageFilePermissions = false,
    bool CanManageAllTasks = false, bool CanCreateTasks = false, bool CanReassignTasks = false, bool CanReassignMyTasks = false,
    bool CanViewQaStage = true, bool CanViewManagerStage = true, bool CanViewFinalReleaseStage = true,
    bool CanApprove = false, bool CanReject = false, bool CanResolveDocumentId = false, bool CanSendAnnouncements = false,
    bool CanDeleteReminders = false, bool CanDeleteDocumentVersions = false, bool CanManageBulkActions = false);

public record RenamePageAccessRoleRequest(string NewRole);

public record CreatePageAccessRoleRequest(
    string Role,
    bool CanViewDashboard, bool CanViewDocumentLibrary, bool CanViewReminders,
    bool CanViewApprovals, bool CanViewPcar, bool CanViewAdminPanel, bool BypassFolderPermissions,
    bool CanReadAllFolders = false, bool CanReadWriteAllFolders = false,
    bool CanEditFiles = false, bool CanManageFolderPermissions = false, bool CanManageFilePermissions = false,
    bool CanManageAllTasks = false, bool CanCreateTasks = false, bool CanReassignTasks = false, bool CanReassignMyTasks = false,
    bool CanViewQaStage = true, bool CanViewManagerStage = true, bool CanViewFinalReleaseStage = true,
    bool CanApprove = false, bool CanReject = false, bool CanResolveDocumentId = false, bool CanSendAnnouncements = false,
    bool CanDeleteReminders = false, bool CanDeleteDocumentVersions = false, bool CanManageBulkActions = false);
