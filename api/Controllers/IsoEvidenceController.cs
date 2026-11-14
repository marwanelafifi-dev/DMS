using DMS.Api.Data;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

// The ISO evidence source is intentionally path-scoped, never tag-scoped:
// only records below Corporate/QMS/Procedures/**/Evidences are reportable.
// Legacy material below OLD DMS is retained in the library but cannot leak
// into operational readiness or Management Review reporting.
[ApiController]
[Route("api/iso-evidence")]
public class IsoEvidenceController(DmsContext context, AccessOverrideService accessOverrideService) : BaseController
{
    [HttpGet]
    public async Task<ActionResult<object>> GetActiveEvidence([FromQuery] string standard = "ISO 9001:2015", [FromQuery] Guid? auditCycleId = null)
    {
        if (standard is not ("ISO 9001:2015" or "ISO 27001:2022")) return BadRequest(new { success = false, error = "Unsupported ISO standard" });
        var userId = GetCurrentUserId();
        var accessibleFolderIds = await GetAccessibleFolderIdsAsync(context, userId, accessOverrideService);
        var folders = await context.Folders.AsNoTracking()
            .Select(folder => new { folder.FolderId, folder.ParentFolderId, folder.Name, folder.Department })
            .ToListAsync();
        var byId = folders.ToDictionary(folder => folder.FolderId);
        string[] Path(Guid id)
        {
            var result = new List<string>(); var current = id; var guard = 0;
            while (byId.TryGetValue(current, out var folder) && guard++ < 64)
            {
                result.Insert(0, folder.Name);
                if (!folder.ParentFolderId.HasValue) break;
                current = folder.ParentFolderId.Value;
            }
            return result.ToArray();
        }
        var evidenceFolderIds = folders.Where(folder =>
        {
            var path = Path(folder.FolderId);
            var inControlledSource = path.Length >= 5
                && string.Equals(path[0], "Corporate", StringComparison.OrdinalIgnoreCase)
                && string.Equals(path[1], "QMS", StringComparison.OrdinalIgnoreCase)
                && string.Equals(path[2], "Procedures", StringComparison.OrdinalIgnoreCase)
                && path.Skip(3).Any(name => string.Equals(name, "Evidences", StringComparison.OrdinalIgnoreCase))
                && !path.Any(name => string.Equals(name, "OLD DMS", StringComparison.OrdinalIgnoreCase));
            if (!inControlledSource) return false;
            var iso27001 = path.Skip(3).Any(name => string.Equals(name, "ISO 27001", StringComparison.OrdinalIgnoreCase));
            return standard == "ISO 27001:2022" ? iso27001 : !iso27001;
        }).Select(folder => folder.FolderId).ToHashSet();

        if (accessibleFolderIds != null) evidenceFolderIds.IntersectWith(accessibleFolderIds);
        var documents = await context.Documents.AsNoTracking()
            .Where(document => evidenceFolderIds.Contains(document.FolderId))
            .Join(context.Users.AsNoTracking(), document => document.OwnerId, user => user.UserId,
                (document, owner) => new { document, owner.FullName })
            .ToListAsync();

        var activeCycleId = auditCycleId ?? await context.AuditCycles.Where(c => c.Standard == standard && c.Status == "active").Select(c => (Guid?)c.AuditCycleId).FirstOrDefaultAsync();
        var documentIds = documents.Select(row => row.document.DocumentId).ToList();
        // Evidence is cycle-specific at version level. Keep historic-cycle
        // evidence reportable even after the document receives a newer version
        // for a later cycle; consumers can use AssignedVersionId to retrieve
        // exactly what was presented for the selected cycle.
        var assignedVersions = activeCycleId.HasValue
            ? await context.EvidenceVersionCycleAssignments.AsNoTracking()
                .Where(assignment => documentIds.Contains(assignment.DocumentId) && assignment.AuditCycleId == activeCycleId)
                .Select(assignment => new { assignment.DocumentId, assignment.VersionId })
                .ToListAsync()
            : [];
        return Ok(new
        {
            success = true,
            data = documents.Select(row => new
            {
                row.document.DocumentId, row.document.Title, row.document.FolderId, row.document.Department,
                row.document.Category, row.document.Status, row.document.Tags, row.document.CreatedAt, row.document.UpdatedAt,
                OwnerName = row.FullName,
                FolderPath = string.Join(" / ", Path(row.document.FolderId)),
                AssignedVersionId = assignedVersions.FirstOrDefault(assignment => assignment.DocumentId == row.document.DocumentId)?.VersionId,
                IsAssignedToSelectedCycle = assignedVersions.Any(assignment => assignment.DocumentId == row.document.DocumentId),
                IsCurrentVersionForSelectedCycle = assignedVersions.Any(assignment => assignment.DocumentId == row.document.DocumentId && assignment.VersionId == row.document.CurrentVersionId),
            }),
            count = documents.Count,
            standard,
            auditCycleId = activeCycleId,
            scope = standard == "ISO 27001:2022" ? "Corporate/QMS/Procedures/IT/ISO 27001/Evidences/**" : "Corporate/QMS/Procedures/**/Evidences/** excluding IT/ISO 27001",
        });
    }
}
