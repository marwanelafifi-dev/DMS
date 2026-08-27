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
            var editBaseline = adminBaseline || role == FolderRoles.Manager || pageAccessRole?.CanEditFiles == true;
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
                // Editing the folder's own Description/Classification (distinct
                // from Rename, which only changes its name) — hidden by default,
                // same adminBaseline-only pattern as Copy/Cut/DownloadZip above.
                FolderEdit = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.FolderEdit, adminBaseline),
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
                // Default to the same baseline as Read (ViewOnly) — an override can
                // still deny/allow these independently of Read itself.
                ViewHistory = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.ViewHistory, Baseline(p => p.ViewOnly)),
                ViewRelatedTasks = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.ViewRelatedTasks, Baseline(p => p.ViewOnly)),
                ViewMetadataHistory = await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.ViewMetadataHistory, Baseline(p => p.ViewOnly)),
                // Ownership reassignment is intentionally stronger than ordinary
                // metadata editing. Assigned Managers may edit metadata, but only
                // an effective folder Admin (owner/Full Access/explicit Admin)
                // may transfer a document to another owner.
                CanChangeDocumentOwner = role == FolderRoles.Admin,
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
                    f.Department,
                    f.Tags,
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
            var managerIds = await context.FolderManagers
                .Where(m => m.FolderId == id)
                .Select(m => m.UserId)
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
                    folder.Department,
                    folder.Tags,
                    folder.ParentFolderId,
                    folder.OwnerId,
                    folder.CreatedAt,
                    folder.UpdatedAt,
                    ManagerIds = managerIds,
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

    // PUT /api/folders/{id} — rename a folder (name only). Gated on the
    // "Rename" action. Description/Classification go through the dedicated
    // /metadata endpoint below instead, gated separately on "Edit" — folded
    // into this single endpoint before, a Rename-only grant could silently
    // also rewrite Description/Classification with no separate permission
    // check at all.
    [HttpPut("{id}")]
    public async Task<ActionResult<object>> UpdateFolder(Guid id, [FromBody] UpdateFolderRequest req)
    {
        try
        {
            var folder = await context.Folders
                .FirstOrDefaultAsync(f => f.FolderId == id);

            if (folder == null)
                return NotFound(new { success = false, error = "Folder not found" });

            var previousName = folder.Name;

            if (!string.IsNullOrWhiteSpace(req.Name))
                folder.Name = req.Name.Trim();

            folder.UpdatedAt = DateTime.UtcNow;

            context.Folders.Update(folder);
            await context.SaveChangesAsync();

            var currentUserId = GetCurrentUserId();
            await auditService.LogAsync(currentUserId, AuditActions.FOLDER_UPDATED, new
            {
                folder.FolderId,
                FolderPath = await auditService.ResolveFolderPathAsync(folder.FolderId),
                Changes = AuditService.BuildChanges(("Name", previousName, folder.Name)),
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

    // PUT /api/folders/{id}/metadata — edit the folder's own Description,
    // Classification, Department, Tags, and Owner. Gated on the dedicated
    // FolderEdit action (see RBACMiddleware.ActionForMethod), separate from
    // Rename — hidden by default (adminBaseline-only), an admin must
    // explicitly grant it per user/group via a File/Folder Permission
    // override, same as Edit (document metadata) and Manage Permissions.
    [HttpPut("{id}/metadata")]
    public async Task<ActionResult<object>> UpdateFolderMetadata(Guid id, [FromBody] UpdateFolderRequest req)
    {
        try
        {
            var folder = await context.Folders
                .FirstOrDefaultAsync(f => f.FolderId == id);

            if (folder == null)
                return NotFound(new { success = false, error = "Folder not found" });

            var previousDescription = folder.Description;
            var previousClassification = folder.Classification;
            var previousDepartment = folder.Department;
            var previousTags = folder.Tags;
            var previousOwnerId = folder.OwnerId;
            var previousManagerIds = await context.FolderManagers
                .Where(m => m.FolderId == id)
                .Select(m => m.UserId)
                .ToListAsync();
            var currentUserId = GetCurrentUserId();

            if (req.Description != null)
                folder.Description = req.Description.Trim();

            if (!string.IsNullOrWhiteSpace(req.Classification))
                folder.Classification = req.Classification.Trim();

            if (req.Department != null)
                folder.Department = req.Department.Trim();

            if (req.Tags != null)
                folder.Tags = req.Tags.Select(t => t.Trim()).Where(t => t.Length > 0).Distinct().ToArray();

            if (req.OwnerId.HasValue)
            {
                if (!await context.Users.AnyAsync(u => u.UserId == req.OwnerId.Value && u.IsActive))
                    return BadRequest(new { success = false, error = "Owner not found or disabled" });
                folder.OwnerId = req.OwnerId.Value;
            }

            if (req.ManagerIds != null)
            {
                var managerIds = req.ManagerIds.Where(managerId => managerId != folder.OwnerId).Distinct().ToList();
                var activeManagerCount = await context.Users.CountAsync(u => managerIds.Contains(u.UserId) && u.IsActive);
                if (activeManagerCount != managerIds.Count)
                    return BadRequest(new { success = false, error = "Every selected folder manager must be an active user" });

                var existingManagers = await context.FolderManagers.Where(m => m.FolderId == id).ToListAsync();
                var removedManagerIds = existingManagers.Where(m => !managerIds.Contains(m.UserId)).Select(m => m.UserId).ToList();
                context.FolderManagers.RemoveRange(existingManagers.Where(m => removedManagerIds.Contains(m.UserId)));
                context.FolderManagers.AddRange(managerIds
                    .Where(managerId => existingManagers.All(m => m.UserId != managerId))
                    .Select(managerId => new DmsFolderManager { FolderId = id, UserId = managerId }));

                var managerPermissions = await context.FolderPermissions
                    .Where(p => p.FolderId == id && managerIds.Contains(p.UserId))
                    .ToListAsync();
                var fullAccessManagerIds = await context.Users
                    .Where(u => managerIds.Contains(u.UserId) && u.Role != null)
                    .Join(
                        context.PageAccessRoles.Where(r => r.BypassFolderPermissions),
                        u => u.Role,
                        r => r.Role,
                        (u, _) => u.UserId)
                    .ToListAsync();
                foreach (var managerId in managerIds)
                {
                    var permission = managerPermissions.FirstOrDefault(p => p.UserId == managerId);
                    var synchronizedRole = fullAccessManagerIds.Contains(managerId) ? FolderRoles.Admin : FolderRoles.Manager;
                    if (permission == null)
                        context.FolderPermissions.Add(new DmsFolderPermission
                        {
                            PermissionId = Guid.NewGuid(), FolderId = id, UserId = managerId,
                            Role = synchronizedRole, GrantedAt = DateTime.UtcNow, GrantedById = currentUserId
                        });
                    else if (permission.Role != synchronizedRole && permission.Role != FolderRoles.Admin)
                        permission.Role = synchronizedRole;
                }

                // Keep the direct Folder Permissions list synchronized with the
                // manager picker. Only remove the exact Manager grant; preserve
                // any independently stronger Admin grant.
                var removedManagerPermissions = await context.FolderPermissions
                    .Where(p => p.FolderId == id && removedManagerIds.Contains(p.UserId) && p.Role == FolderRoles.Manager)
                    .ToListAsync();
                context.FolderPermissions.RemoveRange(removedManagerPermissions);
            }

            if (previousOwnerId != folder.OwnerId)
            {
                var previousOwnerPermission = await context.FolderPermissions
                    .FirstOrDefaultAsync(p => p.FolderId == id && p.UserId == previousOwnerId && p.Role == FolderRoles.Admin);
                if (previousOwnerPermission != null)
                {
                    if (req.ManagerIds?.Contains(previousOwnerId) == true)
                        previousOwnerPermission.Role = FolderRoles.Manager;
                    else
                        context.FolderPermissions.Remove(previousOwnerPermission);
                }
            }

            var ownerPermission = await context.FolderPermissions
                .FirstOrDefaultAsync(p => p.FolderId == id && p.UserId == folder.OwnerId);
            if (ownerPermission == null)
                context.FolderPermissions.Add(CreateOwnerPermission(id, folder.OwnerId, currentUserId));
            else if (ownerPermission.Role != FolderRoles.Admin)
                ownerPermission.Role = FolderRoles.Admin;

            folder.UpdatedAt = DateTime.UtcNow;

            context.Folders.Update(folder);
            await context.SaveChangesAsync();

            // Owner is logged by name, not a bare GUID, so the audit entry
            // reads clearly without needing a separate user lookup.
            string? previousOwnerName = null, newOwnerName = null;
            if (previousOwnerId != folder.OwnerId)
            {
                var ownerNames = await context.Users.AsNoTracking()
                    .Where(u => u.UserId == previousOwnerId || u.UserId == folder.OwnerId)
                    .ToDictionaryAsync(u => u.UserId, u => u.FullName);
                previousOwnerName = ownerNames.GetValueOrDefault(previousOwnerId, previousOwnerId.ToString());
                newOwnerName = ownerNames.GetValueOrDefault(folder.OwnerId, folder.OwnerId.ToString());
            }

            await auditService.LogAsync(currentUserId, AuditActions.FOLDER_UPDATED, new
            {
                folder.FolderId,
                FolderPath = await auditService.ResolveFolderPathAsync(folder.FolderId),
                Changes = AuditService.BuildChanges(
                    ("Description", previousDescription, folder.Description),
                    ("Classification", previousClassification, folder.Classification),
                    ("Department", previousDepartment, folder.Department),
                    ("Tags", previousTags, folder.Tags),
                    ("Owner", previousOwnerName, newOwnerName),
                    ("Managers", string.Join(", ", previousManagerIds), string.Join(", ", req.ManagerIds ?? previousManagerIds))),
            });

            logger.LogInformation("Updated folder metadata {FolderId}", id);

            return Ok(new
            {
                success = true,
                data = new
                {
                    folder.FolderId,
                    folder.Description,
                    folder.Classification,
                    folder.Department,
                    folder.Tags,
                    folder.OwnerId,
                    ManagerIds = await context.FolderManagers.Where(m => m.FolderId == id).Select(m => m.UserId).ToListAsync(),
                    folder.UpdatedAt
                }
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error updating folder metadata {FolderId}", id);
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // POST /api/folders/{id}/move — move a folder (and everything beneath it)
    // under a different parent. Like the equivalent document move, this
    // previously only ever existed as a client-side React state mutation with
    // no backend call at all — it looked like it worked until a reload or a
    // different user's session showed the folder back in its original place.
    // Needs Cut permission on the folder being moved (adminBaseline, same as
    // the UI's own Move button) and CreateSubfolder permission on the
    // destination (moving a folder in is equivalent to creating one there).
    [HttpPost("{id}/move")]
    public async Task<ActionResult<object>> MoveFolder(Guid id, [FromBody] MoveFolderRequest req)
    {
        try
        {
            var folder = await context.Folders.FirstOrDefaultAsync(f => f.FolderId == id);
            if (folder == null)
                return NotFound(new { success = false, error = "Folder not found" });

            if (folder.ParentFolderId == req.DestinationFolderId)
                return BadRequest(new { success = false, error = "The folder is already in this location" });

            if (req.DestinationFolderId == id)
                return BadRequest(new { success = false, error = "A folder cannot be moved into itself" });

            // A folder can't be moved into one of its own descendants — walk the
            // subtree the same way the frontend's own destination-picker does.
            var allFolders = await context.Folders.AsNoTracking().Select(f => new { f.FolderId, f.ParentFolderId }).ToListAsync();
            var descendantIds = new HashSet<Guid>();
            var queue = new Queue<Guid>();
            queue.Enqueue(id);
            while (queue.Count > 0)
            {
                var current = queue.Dequeue();
                foreach (var child in allFolders.Where(f => f.ParentFolderId == current))
                {
                    if (descendantIds.Add(child.FolderId))
                        queue.Enqueue(child.FolderId);
                }
            }
            if (descendantIds.Contains(req.DestinationFolderId))
                return BadRequest(new { success = false, error = "A folder cannot be moved into one of its own subfolders" });

            if (!allFolders.Any(f => f.FolderId == req.DestinationFolderId))
                return BadRequest(new { success = false, error = "Destination folder not found" });

            var userId = GetCurrentUserId();

            var sourceEffectiveRole = await GetEffectiveRoleAsync(context, userId, id);
            var sourceAdminBaseline = sourceEffectiveRole == FolderRoles.Admin;
            if (!await accessOverrideService.ResolveAsync(userId, null, id, AccessOverrideActions.Cut, sourceAdminBaseline))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have permission to move this folder" });

            var destinationEffectiveRole = await GetEffectiveRoleAsync(context, userId, req.DestinationFolderId);
            var destinationRoleAllowsCreateSubfolder = await HasRolePermissionAsync(context, destinationEffectiveRole, rp => rp.CreateSubfolder);
            if (!await accessOverrideService.ResolveAsync(userId, null, req.DestinationFolderId, AccessOverrideActions.CreateSubfolder, destinationRoleAllowsCreateSubfolder))
                return StatusCode(StatusCodes.Status403Forbidden, new { success = false, error = "Your role does not have permission to create a subfolder in the destination" });

            var previousParentId = folder.ParentFolderId;
            folder.ParentFolderId = req.DestinationFolderId;
            folder.UpdatedAt = DateTime.UtcNow;
            await context.SaveChangesAsync();

            await auditService.LogAsync(userId, AuditActions.FOLDER_MOVED, new
            {
                folder.FolderId,
                previousParentId,
                newParentId = req.DestinationFolderId,
            });

            logger.LogInformation("Moved folder {FolderId} from parent {PreviousParentId} to {NewParentId}", id, previousParentId, req.DestinationFolderId);

            return Ok(new { success = true, data = new { folder.FolderId, folder.ParentFolderId, folder.UpdatedAt } });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error moving folder {FolderId}", id);
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

            var currentUserId = GetCurrentUserId();
            var allFolders = await context.Folders.ToListAsync();
            var folderIds = new HashSet<Guid> { id };
            var added = true;
            while (added)
            {
                added = false;
                foreach (var candidate in allFolders.Where(f => f.ParentFolderId.HasValue && folderIds.Contains(f.ParentFolderId.Value)))
                    added |= folderIds.Add(candidate.FolderId);
            }
            var deletedAt = DateTime.UtcNow;
            var batchId = Guid.NewGuid();
            foreach (var deletedFolder in allFolders.Where(f => folderIds.Contains(f.FolderId)))
            {
                deletedFolder.DeletedAt = deletedAt;
                deletedFolder.DeletedById = currentUserId;
                deletedFolder.DeletionBatchId = batchId;
                deletedFolder.UpdatedAt = deletedAt;
            }
            var documents = await context.Documents.Where(d => folderIds.Contains(d.FolderId)).ToListAsync();
            foreach (var document in documents)
            {
                document.DeletedAt = deletedAt;
                document.DeletedById = currentUserId;
                document.DeletionBatchId = batchId;
                document.UpdatedAt = deletedAt;
            }
            await context.SaveChangesAsync();

            await auditService.LogAsync(currentUserId, AuditActions.FOLDER_DELETED, new
            {
                folder.FolderId,
                folder.Name,
                folder.Classification,
                DeletionBatchId = batchId,
                FolderCount = folderIds.Count,
                DocumentCount = documents.Count,
                DeletedAt = deletedAt,
                Recoverable = true
            });

            logger.LogInformation("Deleted folder {FolderId}", id);

            return Ok(new { success = true, message = "Folder moved to the recycle bin" });
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
    string? Classification = null,
    string? Department = null,
    string[]? Tags = null,
    Guid? OwnerId = null,
    List<Guid>? ManagerIds = null
);

public record MoveFolderRequest(Guid DestinationFolderId);
