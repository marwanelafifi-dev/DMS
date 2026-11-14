using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/evidence-requirements")]
public class EvidenceRequirementsController(DmsContext context, AccessOverrideService accessOverrideService) : BaseController
{
    [HttpGet]
    public async Task<ActionResult<object>> List([FromQuery] Guid auditCycleId)
    {
        var userId = GetCurrentUserId();
        var raw = await context.EvidenceRequirements.AsNoTracking().Where(requirement => requirement.AuditCycleId == auditCycleId)
            .Join(context.Documents.AsNoTracking(), requirement => requirement.RelatedDocumentId, document => document.DocumentId, (requirement, document) => new { requirement.EvidenceRequirementId, requirement.AuditCycleId, requirement.Standard, requirement.RelatedDocumentId, DocumentTitle = document.Title, document.FolderId }).ToListAsync();
        var linkedDocumentIds = await context.EvidenceLinks.AsNoTracking().Where(link => link.AuditCycleId == auditCycleId).Select(link => link.RelatedDocumentId).Distinct().ToListAsync();
        var visible = new List<object>();
        foreach (var item in raw)
            if (await accessOverrideService.HasDocumentReadAccessAsync(userId, item.RelatedDocumentId, item.FolderId))
                visible.Add(new { item.EvidenceRequirementId, item.AuditCycleId, item.Standard, item.RelatedDocumentId, item.DocumentTitle, item.FolderId, HasEvidence = linkedDocumentIds.Contains(item.RelatedDocumentId) });
        return Ok(new { success = true, data = visible });
    }

    [HttpPost]
    public async Task<ActionResult<object>> Create([FromBody] EvidenceRequirementRequest request)
    {
        var userId = GetCurrentUserId();
        if ((await GetPageAccessRoleAsync(context, userId))?.CanCreatePcars != true) return Forbid();
        if (!await context.AuditCycles.AnyAsync(cycle => cycle.AuditCycleId == request.AuditCycleId && cycle.Standard == request.Standard)) return BadRequest(new { success = false, error = "Select a valid audit cycle" });
        var document = await context.Documents.AsNoTracking().FirstOrDefaultAsync(item => item.DocumentId == request.RelatedDocumentId);
        if (document == null || !await accessOverrideService.HasDocumentReadAccessAsync(userId, document.DocumentId, document.FolderId)) return BadRequest(new { success = false, error = "Select a controlled document you can access" });
        var folders = await context.Folders.AsNoTracking().Select(folder => new { folder.FolderId, folder.ParentFolderId, folder.Name }).ToListAsync();
        var paths = folders.ToDictionary(folder => folder.FolderId, folder => (folder.ParentFolderId, folder.Name));
        if (ResolveStandard(document.FolderId, paths) != request.Standard) return BadRequest(new { success = false, error = "The controlled document is not in the selected ISO standard's procedure area" });
        if (await context.EvidenceRequirements.AnyAsync(requirement => requirement.AuditCycleId == request.AuditCycleId && requirement.RelatedDocumentId == request.RelatedDocumentId)) return Ok(new { success = true, message = "Requirement already exists" });
        var item = new DmsEvidenceRequirement { EvidenceRequirementId = Guid.NewGuid(), AuditCycleId = request.AuditCycleId, Standard = request.Standard, RelatedDocumentId = request.RelatedDocumentId, CreatedBy = userId, CreatedAt = DateTime.UtcNow };
        context.EvidenceRequirements.Add(item); await context.SaveChangesAsync();
        return Ok(new { success = true, data = item });
    }

    [HttpDelete("{id:guid}")]
    public async Task<ActionResult<object>> Delete(Guid id)
    {
        var userId = GetCurrentUserId();
        if ((await GetPageAccessRoleAsync(context, userId))?.CanCreatePcars != true) return Forbid();
        var item = await context.EvidenceRequirements.FindAsync(id); if (item == null) return NotFound();
        context.EvidenceRequirements.Remove(item); await context.SaveChangesAsync(); return Ok(new { success = true });
    }

    private static string? ResolveStandard(Guid folderId, IReadOnlyDictionary<Guid, (Guid? ParentFolderId, string Name)> folders)
    {
        var path = new List<string>(); var current = folderId; var guard = 0;
        while (folders.TryGetValue(current, out var folder) && guard++ < 64) { path.Insert(0, folder.Name); if (!folder.ParentFolderId.HasValue) break; current = folder.ParentFolderId.Value; }
        var isProcedureDocument = path.Count >= 4 && path[0].Equals("Corporate", StringComparison.OrdinalIgnoreCase) && path[1].Equals("QMS", StringComparison.OrdinalIgnoreCase) && path[2].Equals("Procedures", StringComparison.OrdinalIgnoreCase) && !path.Any(segment => segment.Equals("Evidences", StringComparison.OrdinalIgnoreCase)) && !path.Any(segment => segment.Equals("OLD DMS", StringComparison.OrdinalIgnoreCase));
        if (!isProcedureDocument) return null;
        return path.Skip(3).Any(segment => segment.Equals("ISO 27001", StringComparison.OrdinalIgnoreCase)) ? "ISO 27001:2022" : "ISO 9001:2015";
    }
}

public record EvidenceRequirementRequest(Guid AuditCycleId, string Standard, Guid RelatedDocumentId);
