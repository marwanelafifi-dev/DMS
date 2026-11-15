using DMS.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

// Readiness is deliberately scoped by DMS Group membership, not by the
// imported HR/Google "Department" text. A department is recognised only when
// a user's group name exactly matches a direct child of Corporate/QMS/Procedures.
// This makes the mapping administrator-controlled and avoids hard-coded names.
public sealed class IsoReadinessVisibilityService(DmsContext context)
{
    public sealed record Scope(bool CanViewAll, HashSet<Guid> DepartmentFolderIds);

    public async Task<Scope> GetScopeAsync(Guid userId)
    {
        var role = await (
            from user in context.Users.AsNoTracking()
            join pageRole in context.PageAccessRoles.AsNoTracking() on user.Role equals pageRole.Role into roles
            from pageRole in roles.DefaultIfEmpty()
            where user.UserId == userId
            select pageRole
        ).FirstOrDefaultAsync();

        if (role?.BypassFolderPermissions == true || role?.CanViewAllIsoReadiness == true)
            return new Scope(true, []);

        var groupNames = await (
            from member in context.GroupMembers.AsNoTracking()
            join dmsGroup in context.Groups.AsNoTracking() on member.GroupId equals dmsGroup.GroupId
            where member.UserId == userId
            select dmsGroup.Name
        ).ToListAsync();
        var names = groupNames.ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (names.Count == 0) return new Scope(false, []);

        var folders = await context.Folders.AsNoTracking()
            .Where(folder => folder.DeletedAt == null)
            .Select(folder => new { folder.FolderId, folder.ParentFolderId, folder.Name })
            .ToListAsync();
        var byId = folders.ToDictionary(folder => folder.FolderId);
        var procedureRoots = folders.Where(folder => folder.Name.Equals("Procedures", StringComparison.OrdinalIgnoreCase)
            && folder.ParentFolderId is Guid qmsId
            && byId.TryGetValue(qmsId, out var qms) && qms.Name.Equals("QMS", StringComparison.OrdinalIgnoreCase)
            && qms.ParentFolderId is Guid corporateId
            && byId.TryGetValue(corporateId, out var corporate) && corporate.Name.Equals("Corporate", StringComparison.OrdinalIgnoreCase)
            && corporate.ParentFolderId == null)
            .Select(folder => folder.FolderId)
            .ToHashSet();

        return new Scope(false, folders
            .Where(folder => folder.ParentFolderId.HasValue && procedureRoots.Contains(folder.ParentFolderId.Value) && names.Contains(folder.Name))
            .Select(folder => folder.FolderId)
            .ToHashSet());
    }
}
