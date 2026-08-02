using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class FoldersController(DmsContext context, AuditService auditService, AccessOverrideService accessOverrideService, ILogger<FoldersController> logger) : BaseController
{
    private static readonly Guid DevSystemAdminId = Guid.Parse("00000000-0000-0000-0000-000000000001");

    // GET /api/folders/my-permissions?folderId={id} — the current user's
    // effective permission flags, so the frontend can disable/hide actions
    // (Upload, rename, delete, etc.) the user can't perform instead of only
    // finding out from a 403 after they click. Omit folderId to get the
    // user's global-role flags (e.g. for "Create Parent Folder" at the root).
    // Uses the exact same effective-role resolution RBACMiddleware/controllers
    // enforce with, so the UI and the server can never disagree.
    [HttpGet("my-permissions")]
    public async Task<ActionResult<object>> GetMyEffectivePermissions([FromQuery] Guid? folderId)
    {
        try
        {
            var userId = GetCurrentUserId();

            DmsRolePermission? permission;
            if (userId == DevSystemAdminId)
            {
                permission = await context.RolePermissions.AsNoTracking().FirstOrDefaultAsync(rp => rp.Role == FolderRoles.Admin);
            }
            else
            {
                var effectiveRole = await GetEffectiveRoleAsync(context, userId, folderId);
                permission = effectiveRole == null
                    ? null
                    : await context.RolePermissions.AsNoTracking().FirstOrDefaultAsync(rp => rp.Role == effectiveRole);
            }

            // A File/Folder Permission override can grant access on its own,
            // with no folder-role grant at all — so even with no role/no
            // permission row, fall through to a false baseline and let
            // ResolveAsync fold in any Allow override instead of returning
            // "no access" outright.
            var role = permission?.Role;
            bool Baseline(Func<DmsRolePermission, bool> selector) => permission != null && selector(permission);
            // Copy/Cut/DownloadZip (and their file-scope equivalents) have no
            // role flag at all — they're governed exclusively by File/Folder
            // Permission overrides, with the sole exception of the
            // BypassFolderPermissions role ("Full Access"), which acts as
            // Admin everywhere with no override needed.
            var adminBaseline = role == FolderRoles.Admin;

            // Edit/ManagePermissions can also be granted role-wide (blanket, every
            // folder) via the user's global page-access role, same as
            // BypassFolderPermissions — not just per-folder via an Access Override.
            var pageAccessRole = await GetPageAccessRoleAsync(context, userId);
            var editBaseline = adminBaseline || pageAccessRole?.CanEditFiles == true;
            var manageFolderPermissionsBaseline = adminBaseline || pageAccessRole?.CanManageFolderPermissions == true;
            var manageFilePermissionsBaseline = adminBaseline || pageAccessRole?.CanManageFilePermissions == true;

            // Fold in any applicable File/Folder Permission override so the
            // buttons the UI shows/hides match what the server will actually
            // enforce (deny always wins; an allow can widen the role's default).
            var data = new
            {
                Role = role,
                ViewOnly = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.FileRead, Baseline(p => p.ViewOnly)),
                DownloadReadOnly = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.Download, Baseline(p => p.DownloadReadOnly)),
                DownloadForEditing = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.DownloadForEditing, Baseline(p => p.DownloadForEditing)),
                Upload = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.Write, Baseline(p => p.Upload)),
                UpdateFile = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.FileRename, Baseline(p => p.UpdateFile)),
                UpdateFolder = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.Rename, Baseline(p => p.UpdateFolder)),
                CreateSubfolder = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.CreateSubfolder, Baseline(p => p.CreateSubfolder)),
                CreateParentFolder = Baseline(p => p.CreateParentFolder),
                AddTask = Baseline(p => p.AddTask),
                DeleteParentFolder = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.Delete, Baseline(p => p.DeleteParentFolder)),
                DeleteSubfolder = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.Delete, Baseline(p => p.DeleteSubfolder)),
                DeleteFile = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.FileDelete, Baseline(p => p.DeleteFile)),
                SubmitForApproval = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.SubmitForApproval, Baseline(p => p.SubmitForApproval)),
                Approve = Baseline(p => p.Approve),
                Reject = Baseline(p => p.Reject),
                AdminForceUnlock = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.Unlock, Baseline(p => p.AdminForceUnlock)),
                Copy = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.Copy, adminBaseline),
                Cut = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.Cut, adminBaseline),
                DownloadZip = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.DownloadZip, adminBaseline),
                FileCopy = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.FileCopy, adminBaseline),
                FileCut = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.FileCut, adminBaseline),
                // Edit (document metadata) and managing File/Folder Permissions are
                // hidden from everyone by default (adminBaseline) — an Admin must
                // explicitly grant them per user/group via an override, same as
                // Copy/Cut/DownloadZip above.
                Edit = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.FileEdit, editBaseline),
                ManagePermissions = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.ManagePermissions, manageFolderPermissionsBaseline),
                FileManagePermissions = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.FileManagePermissions, manageFilePermissionsBaseline),
                UpdatedAt = permission?.UpdatedAt,
            };

            return Ok(new { success = true, data });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error resolving effective permissions");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // GET /api/folders — list folders the current user has access to
    [HttpGet]
    public async Task<ActionResult<IEnumerable<object>>> GetFolders()
    {
        try
        {
            var accessibleFolderIds = await GetAccessibleFolderIdsAsync(context, GetCurrentUserId(), accessOverrideService);

            var query = context.Folders.AsQueryable();
            if (accessibleFolderIds != null)
                query = query.Where(f => accessibleFolderIds.Contains(f.FolderId));

            var folders = await query
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

    // GET /api/folders/{id} — details of a single folder
    [HttpGet("{id}")]
    public async Task<ActionResult<object>> GetFolder(Guid id)
    {
        try
        {
            var folder = await context.Folders
                .FirstOrDefaultAsync(f => f.FolderId == id);

            if (folder == null)
                return NotFound(new { success = false, error = "Folder not found" });

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

    // POST /api/folders — create a new folder
    [HttpPost]
    public async Task<ActionResult<object>> CreateFolder([FromBody] CreateFolderRequest req)
    {
        try
        {
            var userId = GetCurrentUserId();

            // Validate inputs
            if (string.IsNullOrWhiteSpace(req.Name))
                return BadRequest(new { success = false, error = "Folder name is required" });

            if (req.OwnerId == Guid.Empty)
                return BadRequest(new { success = false, error = "Owner is required" });

            // Folder ownership is derived from the authenticated request. The API
            // does not permit callers to grant Admin access to an arbitrary user.
            if (req.OwnerId != userId)
                return StatusCode(403, new { success = false, error = "Folder owner must match the authenticated user" });

            // Verify owner exists
            var ownerExists = await context.Users
                .AnyAsync(u => u.UserId == userId && u.IsActive);

            if (!ownerExists)
                return BadRequest(new { success = false, error = "Owner not found or disabled" });

            var canCreateFolder = userId == DevSystemAdminId;

            // Verify parent folder if provided
            if (req.ParentFolderId.HasValue)
            {
                var parentExists = await context.Folders
                    .AnyAsync(f => f.FolderId == req.ParentFolderId);

                if (!parentExists)
                    return BadRequest(new { success = false, error = "Parent folder not found" });

                if (!canCreateFolder)
                {
                    var effectiveRole = await GetEffectiveRoleAsync(context, userId, req.ParentFolderId);
                    var roleAllows = await HasRolePermissionAsync(context, effectiveRole, rp => rp.CreateSubfolder);
                    canCreateFolder = await accessOverrideService.ResolveAsync(userId, null, req.ParentFolderId, AccessOverrideActions.CreateSubfolder, roleAllows);
                }
            }
            else if (!canCreateFolder)
            {
                var effectiveRole = await GetEffectiveRoleAsync(context, userId, null);
                canCreateFolder = await HasRolePermissionAsync(context, effectiveRole, rp => rp.CreateParentFolder);
            }

            if (!canCreateFolder)
                return StatusCode(403, new
                {
                    success = false,
                    error = req.ParentFolderId.HasValue
                        ? "Your role does not have Create Subfolder permission"
                        : "Your role does not have Create Parent Folder permission"
                });

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

    // PUT /api/folders/{id} — update folder
    [HttpPut("{id}")]
    public async Task<ActionResult<object>> UpdateFolder(Guid id, [FromBody] UpdateFolderRequest req)
    {
        try
        {
            var folder = await context.Folders
                .FirstOrDefaultAsync(f => f.FolderId == id);

            if (folder == null)
                return NotFound(new { success = false, error = "Folder not found" });

            // Update fields
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

    // DELETE /api/folders/{id} — delete folder
    [HttpDelete("{id}")]
    public async Task<ActionResult<object>> DeleteFolder(Guid id)
    {
        try
        {
            var folder = await context.Folders
                .FirstOrDefaultAsync(f => f.FolderId == id);

            if (folder == null)
                return NotFound(new { success = false, error = "Folder not found" });

            // Verify no documents exist
            var documentCount = await context.Documents
                .Where(d => d.FolderId == id)
                .CountAsync();

            if (documentCount > 0)
                return BadRequest(new
                {
                    success = false,
                    error = $"Cannot delete folder - it contains {documentCount} documents"
                });

            // Delete permissions first
            var permissions = await context.FolderPermissions
                .Where(p => p.FolderId == id)
                .ToListAsync();

            context.FolderPermissions.RemoveRange(permissions);

            // Delete folder
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

            return Ok(new { success = true, message = "Folder deleted successfully" });
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
