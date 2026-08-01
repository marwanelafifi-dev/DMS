using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static DMS.Api.Services.AuditActions;

namespace DMS.Api.Controllers;

// File Permissions / Folder Permissions — per-user or per-group overrides on
// top of the role-based system. See AccessOverrideService for how these are
// resolved (folder scope cascades to subfolders/files; deny always wins).
[ApiController]
[Route("api/access-overrides")]
public class AccessOverridesController(DmsContext context, AuditService auditService, ILogger<AccessOverridesController> logger) : BaseController
{
    // GET /api/access-overrides?folderId={id} or ?documentId={id}
    [HttpGet]
    public async Task<ActionResult<object>> GetOverrides([FromQuery] Guid? folderId, [FromQuery] Guid? documentId)
    {
        try
        {
            if (!folderId.HasValue && !documentId.HasValue)
                return BadRequest(new { success = false, error = "folderId or documentId is required" });

            var overrides = await context.AccessOverrides
                .Where(o => (folderId.HasValue && o.FolderId == folderId) || (documentId.HasValue && o.DocumentId == documentId))
                .OrderByDescending(o => o.CreatedAt)
                .ToListAsync();

            var userTargetIds = overrides.Where(o => o.TargetType == "User").Select(o => o.TargetId).ToList();
            var groupTargetIds = overrides.Where(o => o.TargetType == "Group").Select(o => o.TargetId).ToList();

            var userNames = await context.Users.Where(u => userTargetIds.Contains(u.UserId)).ToDictionaryAsync(u => u.UserId, u => u.FullName);
            var groupNames = await context.Groups.Where(g => groupTargetIds.Contains(g.GroupId)).ToDictionaryAsync(g => g.GroupId, g => g.Name);

            var data = overrides.Select(o => new
            {
                o.OverrideId,
                o.FolderId,
                o.DocumentId,
                o.TargetType,
                o.TargetId,
                TargetName = o.TargetType == "User" ? userNames.GetValueOrDefault(o.TargetId, "Unknown user") : groupNames.GetValueOrDefault(o.TargetId, "Unknown group"),
                o.Read,
                o.Write,
                o.Rename,
                o.Copy,
                o.Cut,
                o.DownloadZip,
                o.CreateSubfolder,
                o.Delete,
                o.FileRead,
                o.FileRename,
                o.FileCopy,
                o.FileCut,
                o.Unlock,
                o.SubmitForApproval,
                o.Download,
                o.DownloadForEditing,
                o.UploadUpdatedFile,
                o.FileDelete,
                o.CreatedAt,
            });

            return Ok(new { success = true, data, count = overrides.Count });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error retrieving access overrides");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/access-overrides — create or replace the override for one target on one resource
    [HttpPost]
    public async Task<ActionResult<object>> CreateOverride([FromBody] CreateAccessOverrideRequest req)
    {
        try
        {
            if (req.FolderId.HasValue == req.DocumentId.HasValue)
                return BadRequest(new { success = false, error = "Exactly one of folderId or documentId is required" });

            if (req.TargetType != "User" && req.TargetType != "Group")
                return BadRequest(new { success = false, error = "targetType must be 'User' or 'Group'" });

            var userId = GetCurrentUserId();

            // Setting permissions is treated as an administrative action —
            // requires the caller's own effective role on this resource to
            // include AdminForceUnlock (matches who can already force-unlock).
            var effectiveRole = await GetEffectiveRoleAsync(context, userId, req.FolderId ?? await ResolveFolderIdAsync(req.DocumentId));
            if (!await HasRolePermissionAsync(context, effectiveRole, rp => rp.AdminForceUnlock))
                return StatusCode(403, new { success = false, error = "You don't have permission to manage File/Folder Permissions here" });

            if (req.TargetType == "User" && !await context.Users.AnyAsync(u => u.UserId == req.TargetId))
                return NotFound(new { success = false, error = "User not found" });
            if (req.TargetType == "Group" && !await context.Groups.AnyAsync(g => g.GroupId == req.TargetId))
                return NotFound(new { success = false, error = "Group not found" });

            var existing = await context.AccessOverrides.FirstOrDefaultAsync(o =>
                o.FolderId == req.FolderId && o.DocumentId == req.DocumentId &&
                o.TargetType == req.TargetType && o.TargetId == req.TargetId);

            var entity = existing ?? new DmsAccessOverride
            {
                OverrideId = Guid.NewGuid(),
                FolderId = req.FolderId,
                DocumentId = req.DocumentId,
                TargetType = req.TargetType,
                TargetId = req.TargetId,
                CreatedBy = userId,
                CreatedAt = DateTime.UtcNow,
            };

            entity.Read = req.Read;
            entity.Write = req.Write;
            entity.Rename = req.Rename;
            entity.Copy = req.Copy;
            entity.Cut = req.Cut;
            entity.DownloadZip = req.DownloadZip;
            entity.CreateSubfolder = req.CreateSubfolder;
            entity.Delete = req.Delete;
            entity.FileRead = req.FileRead;
            entity.FileRename = req.FileRename;
            entity.FileCopy = req.FileCopy;
            entity.FileCut = req.FileCut;
            entity.Unlock = req.Unlock;
            entity.SubmitForApproval = req.SubmitForApproval;
            entity.Download = req.Download;
            entity.DownloadForEditing = req.DownloadForEditing;
            entity.UploadUpdatedFile = req.UploadUpdatedFile;
            entity.FileDelete = req.FileDelete;
            entity.UpdatedAt = DateTime.UtcNow;

            if (existing == null)
                context.AccessOverrides.Add(entity);

            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, existing == null ? ACCESS_OVERRIDE_CREATED : ACCESS_OVERRIDE_UPDATED, entity);

            logger.LogInformation("{Action} access override {OverrideId} for {TargetType} {TargetId}", existing == null ? "Created" : "Updated", entity.OverrideId, entity.TargetType, entity.TargetId);

            return Ok(new { success = true, data = entity });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error creating access override");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // DELETE /api/access-overrides/{id}
    [HttpDelete("{id}")]
    public async Task<ActionResult<object>> DeleteOverride(Guid id)
    {
        try
        {
            var entity = await context.AccessOverrides.FirstOrDefaultAsync(o => o.OverrideId == id);
            if (entity == null)
                return NotFound(new { success = false, error = "Override not found" });

            var userId = GetCurrentUserId();
            var effectiveRole = await GetEffectiveRoleAsync(context, userId, entity.FolderId ?? await ResolveFolderIdAsync(entity.DocumentId));
            if (!await HasRolePermissionAsync(context, effectiveRole, rp => rp.AdminForceUnlock))
                return StatusCode(403, new { success = false, error = "You don't have permission to manage File/Folder Permissions here" });

            context.AccessOverrides.Remove(entity);
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, ACCESS_OVERRIDE_DELETED, new { entity.OverrideId, entity.FolderId, entity.DocumentId, entity.TargetType, entity.TargetId });

            return Ok(new { success = true, message = "Override deleted" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error deleting access override {OverrideId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    private async Task<Guid?> ResolveFolderIdAsync(Guid? documentId)
    {
        if (!documentId.HasValue) return null;
        return await context.Documents.Where(d => d.DocumentId == documentId).Select(d => (Guid?)d.FolderId).FirstOrDefaultAsync();
    }
}

public record CreateAccessOverrideRequest(
    Guid? FolderId, Guid? DocumentId, string TargetType, Guid TargetId,
    bool? Read, bool? Write, bool? Rename, bool? Copy, bool? Cut, bool? DownloadZip, bool? CreateSubfolder, bool? Delete,
    bool? FileRead, bool? FileRename, bool? FileCopy, bool? FileCut,
    bool? Unlock, bool? SubmitForApproval, bool? Download, bool? DownloadForEditing, bool? UploadUpdatedFile, bool? FileDelete);
