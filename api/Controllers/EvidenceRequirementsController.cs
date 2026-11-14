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
            .Join(context.Documents.AsNoTracking(), requirement => requirement.RelatedDocumentId, document => document.DocumentId, (requirement, document) => new { requirement, document })
            .Join(context.Folders.AsNoTracking(), item => item.document.FolderId, folder => folder.FolderId, (item, folder) => new { item.requirement.EvidenceRequirementId, item.requirement.AuditCycleId, item.requirement.Standard, item.requirement.RelatedDocumentId, DocumentTitle = item.document.Title, item.document.FolderId, FolderName = folder.Name }).ToListAsync();
        var linkedDocumentIds = await context.EvidenceLinks.AsNoTracking().Where(link => link.AuditCycleId == auditCycleId).Select(link => link.RelatedDocumentId).Distinct().ToListAsync();
        var visible = new List<object>();
        foreach (var item in raw)
            if (await accessOverrideService.HasDocumentReadAccessAsync(userId, item.RelatedDocumentId, item.FolderId))
                visible.Add(new { item.EvidenceRequirementId, item.AuditCycleId, item.Standard, item.RelatedDocumentId, item.DocumentTitle, item.FolderId, item.FolderName, HasEvidence = linkedDocumentIds.Contains(item.RelatedDocumentId) });
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

    [HttpPost("folders")]
    public async Task<ActionResult<object>> CreateForFolders([FromBody] EvidenceRequirementFolderRequest request)
    {
        var userId = GetCurrentUserId();
        if ((await GetPageAccessRoleAsync(context, userId))?.CanCreatePcars != true) return Forbid();
        if (request.FolderIds == null || request.FolderIds.Length == 0) return BadRequest(new { success = false, error = "Select at least one process folder" });
        if (request.FolderIds.Length > 100) return BadRequest(new { success = false, error = "Select no more than 100 process folders at a time" });
        if (!await context.AuditCycles.AnyAsync(cycle => cycle.AuditCycleId == request.AuditCycleId && cycle.Standard == request.Standard)) return BadRequest(new { success = false, error = "Select a valid audit cycle" });

        var folderIds = request.FolderIds.Distinct().ToArray();
        var folders = await context.Folders.AsNoTracking().Select(folder => new { folder.FolderId, folder.ParentFolderId, folder.Name }).ToListAsync();
        var paths = folders.ToDictionary(folder => folder.FolderId, folder => (folder.ParentFolderId, folder.Name));
        foreach (var folderId in folderIds)
        {
            if (!paths.ContainsKey(folderId) || !await accessOverrideService.HasFolderReadAccessAsync(userId, folderId))
                return BadRequest(new { success = false, error = "One or more selected process folders are unavailable" });
            if (ResolveStandard(folderId, paths) != request.Standard)
                return BadRequest(new { success = false, error = "Each selected folder must be inside the selected ISO standard's Procedures area, not an Evidences or OLD DMS folder" });
        }

        var documents = await context.Documents.AsNoTracking()
            .Where(document => folderIds.Contains(document.FolderId) && document.DeletedAt == null && (document.Category == null || document.Category != "Evidence"))
            .Select(document => new { document.DocumentId, document.FolderId })
            .ToListAsync();
        var accessibleDocuments = new List<(Guid DocumentId, Guid FolderId)>();
        foreach (var document in documents)
            if (await accessOverrideService.HasDocumentReadAccessAsync(userId, document.DocumentId, document.FolderId))
                accessibleDocuments.Add((document.DocumentId, document.FolderId));

        var accessibleDocumentIds = accessibleDocuments.Select(document => document.DocumentId).ToArray();
        var existingDocumentIds = await context.EvidenceRequirements.AsNoTracking()
            .Where(requirement => requirement.AuditCycleId == request.AuditCycleId && accessibleDocumentIds.Contains(requirement.RelatedDocumentId))
            .Select(requirement => requirement.RelatedDocumentId)
            .ToListAsync();
        var newDocumentIds = accessibleDocuments.Select(document => document.DocumentId).Except(existingDocumentIds).ToArray();
        context.EvidenceRequirements.AddRange(newDocumentIds.Select(documentId => new DmsEvidenceRequirement
        {
            EvidenceRequirementId = Guid.NewGuid(), AuditCycleId = request.AuditCycleId, Standard = request.Standard,
            RelatedDocumentId = documentId, CreatedBy = userId, CreatedAt = DateTime.UtcNow,
        }));
        if (newDocumentIds.Length > 0) await context.SaveChangesAsync();

        var foldersWithoutDocuments = folderIds.Where(folderId => accessibleDocuments.All(document => document.FolderId != folderId)).ToArray();
        return Ok(new
        {
            success = true,
            data = new { added = newDocumentIds.Length, alreadyRequired = existingDocumentIds.Count, foldersWithoutControlledDocuments = foldersWithoutDocuments },
        });
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
public record EvidenceRequirementFolderRequest(Guid AuditCycleId, string Standard, Guid[] FolderIds);
