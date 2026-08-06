using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

public class BaseController : ControllerBase
{
    protected Guid GetCurrentUserId()
    {
        if (HttpContext.Items.TryGetValue("UserId", out var userId) && userId is Guid guid)
            return guid;

        throw new UnauthorizedAccessException("User ID not found in context");
    }

    protected DmsUser GetCurrentUser()
    {
        if (HttpContext.Items.TryGetValue("User", out var user) && user is DmsUser dmsUser)
            return dmsUser;

        throw new UnauthorizedAccessException("User not found in context");
    }

    protected string GetUserRole()
    {
        if (HttpContext.Items.TryGetValue("UserRole", out var role) && role is string roleStr)
            return roleStr;

        return "Reader"; // Default role
    }

    protected Guid? GetFolderId()
    {
        if (HttpContext.Items.TryGetValue("FolderId", out var folderId) && folderId is Guid guid)
            return guid;

        return null;
    }

    // Used for actions RBACMiddleware can't gate itself (folder/task creation
    // has no entity ID in the path yet to look up a permission row for). A
    // folder-specific grant on `folderId` wins. The user's global role
    // (dms_users.role) is page/feature access only, NOT a folder-role
    // fallback — the one exception is a role with BypassFolderPermissions
    // ("Full Access"), which is treated as Admin everywhere with no explicit
    // grant needed. With neither, there is no access.
    protected static async Task<string?> GetEffectiveRoleAsync(DmsContext context, Guid userId, Guid? folderId)
    {
        if (folderId.HasValue)
        {
            var grant = await context.FolderPermissions
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.FolderId == folderId.Value && p.UserId == userId);
            if (grant != null)
                return grant.Role;
        }

        var user = await context.Users.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
        if (user?.Role == null)
            return null;

        var pageAccessRole = await context.PageAccessRoles.AsNoTracking().FirstOrDefaultAsync(r => r.Role == user.Role);
        return ResolveBypassRole(pageAccessRole);
    }

    // Full bypass ("Full Access") wins outright; otherwise the tiered
    // Read/Read+Write-everywhere flags fall back to the matching folder role
    // (Reader/Writer) so every existing per-folder permission check keeps
    // working unchanged — these flags just widen what counts as "having a
    // grant" on a folder the user was never explicitly given one on.
    private static string? ResolveBypassRole(DmsPageAccessRole? pageAccessRole)
    {
        if (pageAccessRole?.BypassFolderPermissions == true) return FolderRoles.Admin;
        if (pageAccessRole?.CanReadWriteAllFolders == true) return FolderRoles.Writer;
        if (pageAccessRole?.CanReadAllFolders == true) return FolderRoles.Reader;
        return null;
    }

    // The user's global page-access role can carry blanket, role-wide flags
    // (CanEditFiles, CanManageFilePermissions) that apply everywhere, the same
    // coarse-grained pattern as BypassFolderPermissions — used to widen the
    // Edit/ManagePermissions baseline in DocumentsController and
    // AccessOverridesController without requiring a per-folder Access Override.
    protected static async Task<DmsPageAccessRole?> GetPageAccessRoleAsync(DmsContext context, Guid userId)
    {
        var user = await context.Users.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
        if (user?.Role == null)
            return null;

        return await context.PageAccessRoles.AsNoTracking().FirstOrDefaultAsync(r => r.Role == user.Role);
    }

    protected static async Task<bool> HasRolePermissionAsync(DmsContext context, string? role, Func<DmsRolePermission, bool> selector)
    {
        if (role == null)
            return false;

        var permission = await context.RolePermissions.AsNoTracking().FirstOrDefaultAsync(rp => rp.Role == role);
        return permission != null && selector(permission);
    }

    // Single-folder version of the same "can this user actually see this
    // folder" check as GetAccessibleFolderIdsAsync below — used wherever a
    // specific folder is already in hand (e.g. resolving one document's
    // approval-queue visibility) instead of computing the whole accessible
    // set. BypassFolderPermissions short-circuits to true; otherwise a role
    // grant on this folder is the baseline, and a Deny-Read override still
    // wins over that grant, same deny-always-wins rule as everywhere else.
    protected static async Task<bool> HasFolderReadAccessAsync(DmsContext context, AccessOverrideService accessOverrideService, Guid userId, Guid folderId)
    {
        DmsPageAccessRole? pageAccessRole = null;
        var user = await context.Users.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
        if (user?.Role != null)
        {
            pageAccessRole = await context.PageAccessRoles.AsNoTracking().FirstOrDefaultAsync(r => r.Role == user.Role);
            if (pageAccessRole?.BypassFolderPermissions == true)
                return true;
        }

        var hasGrant = await context.FolderPermissions.AsNoTracking().AnyAsync(p => p.UserId == userId && p.FolderId == folderId);
        if (!hasGrant && (pageAccessRole?.CanReadAllFolders == true || pageAccessRole?.CanReadWriteAllFolders == true))
            hasGrant = true;
        if (!hasGrant)
        {
            var overrideVisibleFolderIds = await accessOverrideService.GetOverrideVisibleFolderIdsAsync(userId);
            hasGrant = overrideVisibleFolderIds.Contains(folderId);
        }

        return await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.Read, hasGrant);
    }

    // Used by folder/document *list* endpoints (GET /api/folders, GET
    // /api/documents) — those have no single ID for RBACMiddleware to gate,
    // so without this a "User"-role account with zero folder grants could
    // still browse every folder/document in the system. Returns null to mean
    // "no filtering needed" (BypassFolderPermissions role), or the exact set
    // of folder IDs the caller may see.
    protected static async Task<HashSet<Guid>?> GetAccessibleFolderIdsAsync(DmsContext context, Guid userId, AccessOverrideService accessOverrideService)
    {
        DmsPageAccessRole? pageAccessRole = null;
        var user = await context.Users.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
        if (user?.Role != null)
        {
            pageAccessRole = await context.PageAccessRoles.AsNoTracking().FirstOrDefaultAsync(r => r.Role == user.Role);
            if (pageAccessRole?.BypassFolderPermissions == true)
                return null;
        }

        var folderIdList = await context.FolderPermissions
            .AsNoTracking()
            .Where(p => p.UserId == userId)
            .Select(p => p.FolderId)
            .ToListAsync();
        var folderIds = folderIdList.ToHashSet();

        // A Read-allow File/Folder Permission override can also grant list
        // visibility on its own, with no folder-role grant at all — otherwise
        // a "User"-role account with only an override sees an empty library.
        var overrideVisibleFolderIds = await accessOverrideService.GetOverrideVisibleFolderIdsAsync(userId);
        folderIds.UnionWith(overrideVisibleFolderIds);

        // "Read Folders Only" / "Read and Write Folders Only" — weaker, tiered
        // versions of BypassFolderPermissions — see every folder in the
        // system by default, same as the full bypass, but still go through
        // the Deny-override subtraction below instead of skipping it outright
        // (unlike the full-bypass short-circuit above, which returns null and
        // is deliberately never subject to override checks).
        if (pageAccessRole?.CanReadAllFolders == true || pageAccessRole?.CanReadWriteAllFolders == true)
        {
            var allFolderIds = await context.Folders.AsNoTracking().Select(f => f.FolderId).ToListAsync();
            folderIds.UnionWith(allFolderIds);
        }

        // A Deny-Read override must be able to take a folder back OUT of view
        // even when the user already holds a per-folder role grant on it (e.g.
        // as the folder's own creator/Admin) — the two computations above are
        // purely additive and never accounted for that, so an explicit Deny
        // was silently ignored for list/browse visibility even though it was
        // already correctly enforced for individual actions (upload, rename,
        // download, ...) via AccessOverrideService.ResolveAsync.
        var deniedFolderIds = new List<Guid>();
        foreach (var folderId in folderIds)
        {
            if (!await accessOverrideService.ResolveAsync(userId, null, folderId, AccessOverrideActions.Read, true))
                deniedFolderIds.Add(folderId);
        }
        folderIds.ExceptWith(deniedFolderIds);

        return folderIds;
    }
}
