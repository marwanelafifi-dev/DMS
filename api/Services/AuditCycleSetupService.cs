using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Services;

public record AuditCycleResponsibleUsers(Guid DepartmentFolderId, Guid[] UserIds);
public record AuditCycleSetupRequest(Guid[] FolderIds, AuditCycleResponsibleUsers[] Departments);
public record AuditCycleUserOption(Guid UserId, string FullName, string Email);
public record AuditCycleFolderOption(Guid FolderId, string Path, Guid DepartmentFolderId, string DepartmentFolderName,
    int ControlledDocumentCount, AuditCycleUserOption[] EligibleUsers);

public class AuditCycleSetupService(DmsContext context, AccessOverrideService accessOverrideService)
{
    public async Task<List<AuditCycleFolderOption>> GetOptionsAsync(string standard, Guid actorId)
    {
        var folders = await context.Folders.AsNoTracking()
            .Select(folder => new { folder.FolderId, folder.ParentFolderId, folder.Name, folder.OwnerId }).ToListAsync();
        var byId = folders.ToDictionary(folder => folder.FolderId);
        var managers = await context.FolderManagers.AsNoTracking().Select(item => new { item.FolderId, item.UserId }).ToListAsync();
        var permissionManagers = await context.FolderPermissions.AsNoTracking()
            .Where(item => item.Role == FolderRoles.Manager)
            .Select(item => new { item.FolderId, item.UserId }).ToListAsync();
        var managersByFolder = managers.Concat(permissionManagers).GroupBy(item => item.FolderId)
            .ToDictionary(group => group.Key, group => group.Select(item => item.UserId).Distinct().ToArray());
        var users = await context.Users.AsNoTracking().Where(user => user.IsActive)
            .Select(user => new AuditCycleUserOption(user.UserId, user.FullName, user.Email)).ToListAsync();
        var usersById = users.ToDictionary(user => user.UserId);
        var documentCounts = await context.Documents.AsNoTracking()
            .Where(document => document.DeletedAt == null && (document.Category == null || document.Category != "Evidence"))
            .GroupBy(document => document.FolderId)
            .Select(group => new { FolderId = group.Key, Count = group.Count() }).ToDictionaryAsync(item => item.FolderId, item => item.Count);
        var result = new List<AuditCycleFolderOption>();
        foreach (var folder in folders)
        {
            var path = new List<Guid>();
            var current = folder.FolderId;
            var seen = new HashSet<Guid>();
            while (byId.TryGetValue(current, out var ancestor) && seen.Add(current) && path.Count < 64)
            {
                path.Insert(0, current);
                if (!ancestor.ParentFolderId.HasValue) break;
                current = ancestor.ParentFolderId.Value;
            }
            if (path.Count < 4 || byId[path[0]].ParentFolderId.HasValue
                || !byId[path[0]].Name.Equals("Corporate", StringComparison.OrdinalIgnoreCase)
                || !byId[path[1]].Name.Equals("QMS", StringComparison.OrdinalIgnoreCase)
                || !byId[path[2]].Name.Equals("Procedures", StringComparison.OrdinalIgnoreCase)) continue;
            var names = path.Select(id => byId[id].Name).ToArray();
            if (names.Any(name => name.Equals("Evidences", StringComparison.OrdinalIgnoreCase)
                || name.Equals("OLD DMS", StringComparison.OrdinalIgnoreCase))) continue;
            var is27001 = names[3].Equals("IT", StringComparison.OrdinalIgnoreCase)
                && names.Skip(4).Any(name => name.Equals("ISO 27001", StringComparison.OrdinalIgnoreCase));
            if (standard == "ISO 27001:2022" ? !is27001 : is27001) continue;
            if (!await accessOverrideService.HasFolderReadAccessAsync(actorId, folder.FolderId)) continue;
            var eligibleIds = path.Skip(3).Select(id => byId[id].OwnerId)
                .Concat(path.Skip(3).SelectMany(id => managersByFolder.GetValueOrDefault(id) ?? Array.Empty<Guid>()))
                .Distinct();
            var eligibleUsers = eligibleIds.Where(usersById.ContainsKey).Select(id => usersById[id])
                .OrderBy(user => user.FullName).ToArray();
            result.Add(new AuditCycleFolderOption(folder.FolderId, string.Join(" / ", names), path[3], names[3],
                documentCounts.GetValueOrDefault(folder.FolderId), eligibleUsers));
        }
        return result.OrderBy(option => option.Path).ToList();
    }

    // Called inside the controller's transaction for both cycle creation and later edits.
    public async Task<string?> ApplyAsync(DmsAuditCycle cycle, AuditCycleSetupRequest setup, Guid actorId)
    {
        if (setup.FolderIds == null || setup.FolderIds.Length is < 1 or > 100)
            return "Select between 1 and 100 process folders";
        if (setup.Departments == null) return "Assign responsible users to every selected department";
        var folderIds = setup.FolderIds.Distinct().ToArray();
        var options = await GetOptionsAsync(cycle.Standard, actorId);
        var byFolderId = options.ToDictionary(option => option.FolderId);
        if (folderIds.Any(id => !byFolderId.ContainsKey(id)))
            return "One or more folders are outside the selected standard's Procedures area or are not accessible";
        var selected = folderIds.Select(id => byFolderId[id]).ToArray();
        var departmentIds = selected.Select(option => option.DepartmentFolderId).Distinct().ToHashSet();
        if (setup.Departments.Length != departmentIds.Count || setup.Departments.Select(item => item.DepartmentFolderId).Distinct().Count() != departmentIds.Count
            || setup.Departments.Any(item => !departmentIds.Contains(item.DepartmentFolderId)))
            return "Map each selected department exactly once";
        foreach (var department in setup.Departments)
        {
            if (department.UserIds == null || department.UserIds.Length == 0 || department.UserIds.Length > 100)
                return "Select at least one responsible owner or manager for every department";
            var eligible = selected.Where(option => option.DepartmentFolderId == department.DepartmentFolderId)
                .SelectMany(option => option.EligibleUsers).Select(user => user.UserId).ToHashSet();
            if (department.UserIds.Any(id => !eligible.Contains(id)))
                return "Responsible users must be active owners or managers of a selected folder or its department parent";
        }

        var previousFolders = await context.AuditCycleCoverageFolders
            .Where(item => item.AuditCycleId == cycle.AuditCycleId).ToListAsync();
        context.AuditCycleCoverageFolders.RemoveRange(previousFolders.Where(item => !folderIds.Contains(item.FolderId)));
        var existingFolderIds = previousFolders.Select(item => item.FolderId).ToHashSet();
        context.AuditCycleCoverageFolders.AddRange(folderIds.Where(id => !existingFolderIds.Contains(id)).Select(id => new DmsAuditCycleCoverageFolder
        {
            AuditCycleId = cycle.AuditCycleId, FolderId = id, AddedBy = actorId, AddedAt = DateTime.UtcNow,
        }));

        var documents = await context.Documents.AsNoTracking()
            .Where(document => folderIds.Contains(document.FolderId) && document.DeletedAt == null && (document.Category == null || document.Category != "Evidence"))
            .Select(document => document.DocumentId).ToListAsync();
        var documentIds = documents.ToHashSet();
        var previousRequirements = await context.EvidenceRequirements
            .Where(item => item.AuditCycleId == cycle.AuditCycleId).ToListAsync();
        context.EvidenceRequirements.RemoveRange(previousRequirements.Where(item => !documentIds.Contains(item.RelatedDocumentId)));
        var previousDocumentIds = previousRequirements.Select(item => item.RelatedDocumentId).ToHashSet();
        context.EvidenceRequirements.AddRange(documents.Where(id => !previousDocumentIds.Contains(id)).Select(id => new DmsEvidenceRequirement
        {
            EvidenceRequirementId = Guid.NewGuid(), AuditCycleId = cycle.AuditCycleId, Standard = cycle.Standard,
            RelatedDocumentId = id, CreatedBy = actorId, CreatedAt = DateTime.UtcNow,
        }));

        var previousContacts = await context.IsoReadinessContacts
            .Where(item => item.AuditCycleId == cycle.AuditCycleId).ToListAsync();
        var desiredContacts = setup.Departments
            .SelectMany(department => department.UserIds.Distinct().Select(userId => (department.DepartmentFolderId, UserId: userId)))
            .ToHashSet();
        context.IsoReadinessContacts.RemoveRange(previousContacts.Where(item => !desiredContacts.Contains((item.DepartmentFolderId, item.UserId))));
        var existingContacts = previousContacts.Select(item => (item.DepartmentFolderId, item.UserId)).ToHashSet();
        context.IsoReadinessContacts.AddRange(desiredContacts.Where(item => !existingContacts.Contains(item)).Select(item => new DmsIsoReadinessContact
        {
            AuditCycleId = cycle.AuditCycleId, DepartmentFolderId = item.DepartmentFolderId, UserId = item.UserId,
            AssignedBy = actorId, AssignedAt = DateTime.UtcNow,
        }));
        await context.SaveChangesAsync();
        return null;
    }
}
