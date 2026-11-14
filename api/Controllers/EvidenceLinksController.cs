using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/evidence-links")]
public class EvidenceLinksController(DmsContext context, AccessOverrideService accessOverrideService) : BaseController
{
    [HttpGet("{documentId:guid}")]
    public async Task<ActionResult<object>> Get(Guid documentId)
    {
        var userId = GetCurrentUserId();
        var evidence = await context.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.DocumentId == documentId);
        if (evidence == null || !await HasFolderReadAccessAsync(context, accessOverrideService, userId, evidence.FolderId)) return Forbid();
        var rawLinks = await context.EvidenceLinks.AsNoTracking()
        .Where(link => link.EvidenceDocumentId == documentId)
        .Join(context.Documents.AsNoTracking(), link => link.RelatedDocumentId, document => document.DocumentId,
            (link, document) => new { link.EvidenceLinkId, link.ProgrammeYear, link.AuditCycleId, link.OwnerId, document.DocumentId, document.Title, document.FolderId })
        .ToListAsync();
        var visibleLinks = new List<object>();
        foreach (var link in rawLinks)
            if (await HasFolderReadAccessAsync(context, accessOverrideService, userId, link.FolderId)) visibleLinks.Add(link);
        return Ok(new { success = true, data = visibleLinks });
    }

    [HttpPost]
    public async Task<ActionResult<object>> Create([FromBody] CreateEvidenceLinkRequest request)
    {
        var ownerId = GetCurrentUserId();
        var evidence = await context.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.DocumentId == request.EvidenceDocumentId);
        var related = await context.Documents.AsNoTracking().FirstOrDefaultAsync(d => d.DocumentId == request.RelatedDocumentId);
        if (evidence == null || related == null) return BadRequest(new { success = false, error = "Evidence and related document must exist" });
        if (!await HasFolderReadAccessAsync(context, accessOverrideService, ownerId, evidence.FolderId) || !await HasFolderReadAccessAsync(context, accessOverrideService, ownerId, related.FolderId)) return Forbid();
        if (evidence.DocumentId == related.DocumentId) return BadRequest(new { success = false, error = "An evidence file cannot link to itself" });
        var folders = await context.Folders.AsNoTracking().Select(f => new { f.FolderId, f.ParentFolderId, f.Name }).ToListAsync();
        var byId = folders.ToDictionary(f => f.FolderId, f => (f.ParentFolderId, f.Name));
        if (!byId.TryGetValue(evidence.FolderId, out var evidenceFolder) || !string.Equals(evidenceFolder.Name, "Evidences", StringComparison.OrdinalIgnoreCase) || evidenceFolder.ParentFolderId != related.FolderId)
            return BadRequest(new { success = false, error = "Related documents must be in the direct parent process folder of the Evidences folder" });
        var standard = ResolveStandard(evidence.FolderId, byId);
        if (standard == null) return BadRequest(new { success = false, error = "Evidence must be stored in an approved ISO Evidence folder" });
        var cycle = await context.AuditCycles.FirstOrDefaultAsync(c => c.Standard == standard && c.Status == "active");
        if (cycle == null) return BadRequest(new { success = false, error = $"No active {standard} audit cycle is configured" });
        var existing = await context.EvidenceLinks.AnyAsync(l => l.EvidenceDocumentId == request.EvidenceDocumentId && l.RelatedDocumentId == request.RelatedDocumentId && l.AuditCycleId == cycle.AuditCycleId);
        if (existing) return Ok(new { success = true, message = "Link already exists" });
        var link = new DmsEvidenceLink { EvidenceLinkId = Guid.NewGuid(), EvidenceDocumentId = request.EvidenceDocumentId, RelatedDocumentId = request.RelatedDocumentId, ProgrammeYear = cycle.StartDate.Year, AuditCycleId = cycle.AuditCycleId, OwnerId = ownerId, CreatedAt = DateTime.UtcNow };
        context.EvidenceLinks.Add(link); await context.SaveChangesAsync();
        return Ok(new { success = true, data = link });
    }

    [HttpDelete("{evidenceLinkId:guid}")]
    public async Task<ActionResult<object>> Delete(Guid evidenceLinkId)
    {
        var userId = GetCurrentUserId();
        var link = await context.EvidenceLinks.FirstOrDefaultAsync(l => l.EvidenceLinkId == evidenceLinkId);
        if (link == null) return NotFound();
        var folders = await context.Documents.AsNoTracking().Where(d => d.DocumentId == link.EvidenceDocumentId || d.DocumentId == link.RelatedDocumentId).Select(d => d.FolderId).ToListAsync();
        if (folders.Count != 2 || !await HasFolderReadAccessAsync(context, accessOverrideService, userId, folders[0]) || !await HasFolderReadAccessAsync(context, accessOverrideService, userId, folders[1])) return Forbid();
        var evidenceRole = await GetEffectiveRoleAsync(context, userId, folders[0]);
        if (evidenceRole is not (FolderRoles.Writer or FolderRoles.Manager or FolderRoles.Admin)) return Forbid();
        context.EvidenceLinks.Remove(link);
        await context.SaveChangesAsync();
        return Ok(new { success = true, data = new { evidenceLinkId } });
    }

    private static string? ResolveStandard(Guid folderId, IReadOnlyDictionary<Guid, (Guid? ParentFolderId, string Name)> folders)
    {
        var path = new List<string>(); var current = folderId; var guard = 0;
        while (folders.TryGetValue(current, out var folder) && guard++ < 64)
        {
            path.Insert(0, folder.Name);
            if (!folder.ParentFolderId.HasValue) break;
            current = folder.ParentFolderId.Value;
        }
        var validQmsRoot = path.Count >= 5 && path[0].Equals("Corporate", StringComparison.OrdinalIgnoreCase) && path[1].Equals("QMS", StringComparison.OrdinalIgnoreCase) && path[2].Equals("Procedures", StringComparison.OrdinalIgnoreCase) && path.Any(p => p.Equals("Evidences", StringComparison.OrdinalIgnoreCase));
        if (!validQmsRoot || path.Any(p => p.Equals("OLD DMS", StringComparison.OrdinalIgnoreCase))) return null;
        return path.Skip(3).Any(p => p.Equals("ISO 27001", StringComparison.OrdinalIgnoreCase)) ? "ISO 27001:2022" : "ISO 9001:2015";
    }
}
public record CreateEvidenceLinkRequest(Guid EvidenceDocumentId, Guid RelatedDocumentId);
