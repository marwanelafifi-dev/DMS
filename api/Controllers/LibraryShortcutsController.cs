using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/library-shortcuts")]
public class LibraryShortcutsController(
    DmsContext context,
    AccessOverrideService accessOverrideService,
    AuditService auditService,
    ILogger<LibraryShortcutsController> logger) : BaseController
{
    [HttpGet]
    public async Task<ActionResult<object>> GetShortcuts([FromQuery] Guid parentFolderId)
    {
        var userId = GetCurrentUserId();
        if (!await accessOverrideService.HasFolderReadAccessAsync(userId, parentFolderId))
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "You do not have access to this folder" });

        var entries = await context.LibraryShortcuts.AsNoTracking()
            .Where(shortcut => shortcut.ParentFolderId == parentFolderId)
            .OrderBy(shortcut => shortcut.CreatedAt)
            .ToListAsync();

        var visible = new List<object>();
        foreach (var shortcut in entries)
        {
            if (shortcut.TargetFolderId.HasValue)
            {
                var folder = await context.Folders.AsNoTracking().FirstOrDefaultAsync(item => item.FolderId == shortcut.TargetFolderId.Value);
                if (folder != null && await accessOverrideService.HasFolderReadAccessAsync(userId, folder.FolderId))
                {
                    visible.Add(new
                    {
                        shortcut.ShortcutId,
                        TargetType = "folder",
                        TargetId = folder.FolderId,
                        Name = folder.Name,
                        Description = folder.Description,
                        shortcut.CreatedAt,
                    });
                }
            }
            else if (shortcut.TargetDocumentId.HasValue)
            {
                var document = await context.Documents.AsNoTracking().FirstOrDefaultAsync(item => item.DocumentId == shortcut.TargetDocumentId.Value);
                if (document != null && await accessOverrideService.HasDocumentReadAccessAsync(userId, document.DocumentId, document.FolderId))
                {
                    visible.Add(new
                    {
                        shortcut.ShortcutId,
                        TargetType = "document",
                        TargetId = document.DocumentId,
                        Name = document.Title,
                        Description = document.Description,
                        shortcut.CreatedAt,
                    });
                }
            }
        }

        return Ok(new { success = true, data = visible });
    }

    [HttpPost]
    public async Task<ActionResult<object>> CreateShortcut([FromBody] CreateLibraryShortcutRequest request)
    {
        var userId = GetCurrentUserId();
        var role = await GetPageAccessRoleAsync(context, userId);
        if (role?.CanCreateShortcuts != true)
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have permission to create library shortcuts" });

        if (request.ParentFolderId == Guid.Empty || (request.TargetFolderId.HasValue == request.TargetDocumentId.HasValue))
            return BadRequest(new { success = false, error = "Choose one valid file or folder target and a destination folder" });

        var destination = await context.Folders.AsNoTracking().FirstOrDefaultAsync(folder => folder.FolderId == request.ParentFolderId);
        if (destination == null)
            return NotFound(new { success = false, error = "Destination folder not found" });

        var effectiveRole = await GetEffectiveRoleAsync(context, userId, destination.FolderId);
        var roleAllowsDestinationWrite = await HasRolePermissionAsync(context, effectiveRole, permission => permission.CreateSubfolder);
        var mayCreateInDestination = await accessOverrideService.ResolveAsync(
            userId, null, destination.FolderId, AccessOverrideActions.CreateSubfolder, roleAllowsDestinationWrite);
        if (!mayCreateInDestination)
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "You do not have permission to add a shortcut in this folder" });

        string targetName;
        if (request.TargetFolderId.HasValue)
        {
            if (request.TargetFolderId.Value == request.ParentFolderId)
                return BadRequest(new { success = false, error = "A folder cannot contain a shortcut to itself" });

            var target = await context.Folders.AsNoTracking().FirstOrDefaultAsync(folder => folder.FolderId == request.TargetFolderId.Value);
            if (target == null)
                return NotFound(new { success = false, error = "Target folder not found" });
            if (!await accessOverrideService.HasFolderReadAccessAsync(userId, target.FolderId))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "You do not have access to the target folder" });
            targetName = target.Name;
        }
        else
        {
            var target = await context.Documents.AsNoTracking().FirstOrDefaultAsync(document => document.DocumentId == request.TargetDocumentId!.Value);
            if (target == null)
                return NotFound(new { success = false, error = "Target file not found" });
            if (!await accessOverrideService.HasDocumentReadAccessAsync(userId, target.DocumentId, target.FolderId))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "You do not have access to the target file" });
            targetName = target.Title;
        }

        var alreadyExists = await context.LibraryShortcuts.AnyAsync(shortcut =>
            shortcut.ParentFolderId == request.ParentFolderId &&
            (request.TargetFolderId.HasValue
                ? shortcut.TargetFolderId == request.TargetFolderId
                : shortcut.TargetDocumentId == request.TargetDocumentId));
        if (alreadyExists)
            return Conflict(new { success = false, error = "This shortcut already exists in the selected folder" });

        var shortcut = new DmsLibraryShortcut
        {
            ShortcutId = Guid.NewGuid(),
            ParentFolderId = request.ParentFolderId,
            TargetFolderId = request.TargetFolderId,
            TargetDocumentId = request.TargetDocumentId,
            CreatedById = userId,
            CreatedAt = DateTime.UtcNow,
        };
        context.LibraryShortcuts.Add(shortcut);
        await context.SaveChangesAsync();
        await auditService.LogAsync(userId, AuditActions.LIBRARY_SHORTCUT_CREATED, new
        {
            shortcut.ShortcutId,
            DestinationFolderId = shortcut.ParentFolderId,
            shortcut.TargetFolderId,
            shortcut.TargetDocumentId,
            TargetName = targetName,
        });

        return CreatedAtAction(nameof(GetShortcuts), new { parentFolderId = shortcut.ParentFolderId }, new { success = true, data = shortcut });
    }

    [HttpDelete("{shortcutId}")]
    public async Task<ActionResult<object>> DeleteShortcut(Guid shortcutId)
    {
        var shortcut = await context.LibraryShortcuts.FirstOrDefaultAsync(item => item.ShortcutId == shortcutId);
        if (shortcut == null)
            return NotFound(new { success = false, error = "Shortcut not found" });

        var userId = GetCurrentUserId();
        var role = await GetPageAccessRoleAsync(context, userId);
        if (role?.CanCreateShortcuts != true)
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have permission to manage library shortcuts" });

        var effectiveRole = await GetEffectiveRoleAsync(context, userId, shortcut.ParentFolderId);
        var roleAllowsDestinationWrite = await HasRolePermissionAsync(context, effectiveRole, permission => permission.CreateSubfolder);
        if (!await accessOverrideService.ResolveAsync(userId, null, shortcut.ParentFolderId, AccessOverrideActions.CreateSubfolder, roleAllowsDestinationWrite))
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "You do not have permission to remove a shortcut from this folder" });

        context.LibraryShortcuts.Remove(shortcut);
        await context.SaveChangesAsync();
        await auditService.LogAsync(userId, AuditActions.LIBRARY_SHORTCUT_DELETED, new { shortcut.ShortcutId, shortcut.ParentFolderId });
        logger.LogInformation("Library shortcut {ShortcutId} removed by {UserId}", shortcutId, userId);
        return Ok(new { success = true });
    }
}

public record CreateLibraryShortcutRequest(Guid ParentFolderId, Guid? TargetFolderId = null, Guid? TargetDocumentId = null);
