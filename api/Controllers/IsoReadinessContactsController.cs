using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/iso-readiness-contacts")]
public class IsoReadinessContactsController(DmsContext context, AccessOverrideService accessOverrideService, AuditCycleSetupService setupService) : BaseController
{
    [HttpGet]
    public async Task<ActionResult<object>> List([FromQuery] Guid auditCycleId)
    {
        if (!await context.AuditCycles.AnyAsync(cycle => cycle.AuditCycleId == auditCycleId)) return NotFound();
        var userId = GetCurrentUserId();
        var assignments = await context.IsoReadinessContacts.AsNoTracking()
            .Where(contact => contact.AuditCycleId == auditCycleId)
            .Select(contact => new { contact.AuditCycleId, contact.DepartmentFolderId, contact.UserId })
            .ToListAsync();
        var visible = new List<object>();
        foreach (var assignment in assignments)
            if (await accessOverrideService.HasFolderReadAccessAsync(userId, assignment.DepartmentFolderId)) visible.Add(assignment);
        return Ok(new { success = true, data = visible });
    }

    [HttpPut("{departmentFolderId:guid}")]
    public async Task<ActionResult<object>> Replace(Guid departmentFolderId, [FromBody] IsoReadinessContactsRequest request)
    {
        var actorId = GetCurrentUserId();
        if ((await GetPageAccessRoleAsync(context, actorId))?.CanViewAdminPanel != true) return Forbid();
        var cycle = await context.AuditCycles.AsNoTracking().FirstOrDefaultAsync(item => item.AuditCycleId == request.AuditCycleId);
        if (cycle == null) return BadRequest(new { success = false, error = "Select a valid audit cycle" });
        if (cycle.Status == "historical") return BadRequest(new { success = false, error = "Historical audit cycles cannot be changed" });
        var folder = await context.Folders.AsNoTracking().FirstOrDefaultAsync(item => item.FolderId == departmentFolderId);
        if (folder == null || !folder.ParentFolderId.HasValue || !await accessOverrideService.HasFolderReadAccessAsync(actorId, departmentFolderId))
            return BadRequest(new { success = false, error = "Select an accessible Procedures department folder" });
        var procedures = await context.Folders.AsNoTracking().FirstOrDefaultAsync(item => item.FolderId == folder.ParentFolderId.Value);
        var qms = procedures?.ParentFolderId is Guid qmsId ? await context.Folders.AsNoTracking().FirstOrDefaultAsync(item => item.FolderId == qmsId) : null;
        var corporate = qms?.ParentFolderId is Guid corporateId ? await context.Folders.AsNoTracking().FirstOrDefaultAsync(item => item.FolderId == corporateId) : null;
        if (!string.Equals(procedures?.Name, "Procedures", StringComparison.OrdinalIgnoreCase)
            || !string.Equals(qms?.Name, "QMS", StringComparison.OrdinalIgnoreCase)
            || !string.Equals(corporate?.Name, "Corporate", StringComparison.OrdinalIgnoreCase)
            || corporate!.ParentFolderId.HasValue)
            return BadRequest(new { success = false, error = "Select a department directly under Corporate / QMS / Procedures" });
        if (cycle.Standard == "ISO 27001:2022" && !folder.Name.Equals("IT", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { success = false, error = "ISO 27001 readiness contacts belong to the IT department" });
        var coveredFolderIds = await context.AuditCycleCoverageFolders.AsNoTracking()
            .Where(item => item.AuditCycleId == cycle.AuditCycleId).Select(item => item.FolderId).ToListAsync();
        var eligibleUsers = (await setupService.GetOptionsAsync(cycle.Standard, actorId))
            .Where(option => coveredFolderIds.Contains(option.FolderId) && option.DepartmentFolderId == departmentFolderId)
            .SelectMany(option => option.EligibleUsers).Select(user => user.UserId).ToHashSet();
        if (eligibleUsers.Count == 0) return BadRequest(new { success = false, error = "Configure this department in Admin → Audit Programme first" });
        if (request.UserIds == null || request.UserIds.Length is < 1 or > 100)
            return BadRequest(new { success = false, error = "Select between 1 and 100 responsible owners or managers" });
        var userIds = request.UserIds.Distinct().ToArray();
        if (userIds.Any(id => !eligibleUsers.Contains(id))) return BadRequest(new { success = false, error = "Select owners or managers of the covered department folders only" });
        var activeCount = await context.Users.CountAsync(user => userIds.Contains(user.UserId) && user.IsActive);
        if (activeCount != userIds.Length) return BadRequest(new { success = false, error = "Select active DMS users only" });

        var previous = await context.IsoReadinessContacts.Where(contact => contact.AuditCycleId == cycle.AuditCycleId && contact.DepartmentFolderId == departmentFolderId).ToListAsync();
        context.IsoReadinessContacts.RemoveRange(previous.Where(contact => !userIds.Contains(contact.UserId)));
        var existing = previous.Select(contact => contact.UserId).ToHashSet();
        context.IsoReadinessContacts.AddRange(userIds.Where(id => !existing.Contains(id)).Select(id => new DmsIsoReadinessContact
        {
            AuditCycleId = cycle.AuditCycleId, DepartmentFolderId = departmentFolderId, UserId = id, AssignedBy = actorId, AssignedAt = DateTime.UtcNow,
        }));
        await context.SaveChangesAsync();
        return Ok(new { success = true, data = userIds });
    }
}

public record IsoReadinessContactsRequest(Guid AuditCycleId, Guid[] UserIds);
