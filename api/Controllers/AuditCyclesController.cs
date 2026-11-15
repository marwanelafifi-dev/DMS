using DMS.Api.Data;
using DMS.Api.Models;
using DMS.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/audit-cycles")]
public class AuditCyclesController(DmsContext context, AuditCycleSetupService setupService, AccessOverrideService accessOverrideService, IsoReadinessVisibilityService visibilityService) : BaseController
{
    [HttpGet]
    public async Task<ActionResult<object>> List()
    {
        return Ok(new { success = true, data = await context.AuditCycles.AsNoTracking().OrderByDescending(c => c.StartDate).ToListAsync() });
    }

    [HttpPost]
    public async Task<ActionResult<object>> Create([FromBody] AuditCycleRequest req)
    {
        if ((await GetPageAccessRoleAsync(context, GetCurrentUserId()))?.CanViewAdminPanel != true) return Forbid();
        if (string.IsNullOrWhiteSpace(req.Name) || req.Name.Trim().Length > 180 || req.Standard is not ("ISO 9001:2015" or "ISO 27001:2022") || req.EndDate < req.StartDate) return BadRequest(new { success = false, error = "Enter a name, supported standard, and valid date range" });
        if (req.Standard == "ISO 27001:2022" && (req.StartDate.Year != req.EndDate.Year || req.StartDate.Month != 1 || req.StartDate.Day != 1 || req.EndDate.Month != 12 || req.EndDate.Day != 31)) return BadRequest(new { success = false, error = "ISO 27001 programmes must run from 1 January through 31 December of one year" });
        if (req.Setup == null) return BadRequest(new { success = false, error = "Select process folders and responsible owners or managers before creating the cycle" });
        var actorId = GetCurrentUserId();
        var cycle = new DmsAuditCycle { AuditCycleId = Guid.NewGuid(), Name = req.Name.Trim(), Standard = req.Standard, StartDate = req.StartDate, EndDate = req.EndDate, Status = "planned", CreatedAt = DateTime.UtcNow, CreatedBy = actorId };
        await using var transaction = await context.Database.BeginTransactionAsync();
        context.AuditCycles.Add(cycle);
        await context.SaveChangesAsync();
        var error = await setupService.ApplyAsync(cycle, req.Setup, actorId);
        if (error != null) return BadRequest(new { success = false, error });
        await transaction.CommitAsync();
        return Ok(new { success = true, data = cycle });
    }

    [HttpGet("setup-options")]
    public async Task<ActionResult<object>> GetSetupOptions([FromQuery] string standard)
    {
        var userId = GetCurrentUserId();
        if ((await GetPageAccessRoleAsync(context, userId))?.CanViewAdminPanel != true) return Forbid();
        if (standard is not ("ISO 9001:2015" or "ISO 27001:2022")) return BadRequest(new { success = false, error = "Select an ISO standard" });
        return Ok(new { success = true, data = await setupService.GetOptionsAsync(standard, userId) });
    }

    [HttpGet("{id:guid}/setup")]
    public async Task<ActionResult<object>> GetSetup(Guid id)
    {
        if (!await context.AuditCycles.AnyAsync(cycle => cycle.AuditCycleId == id)) return NotFound();
        var userId = GetCurrentUserId();
        var scope = await visibilityService.GetScopeAsync(userId);
        var folders = await context.AuditCycleCoverageFolders.AsNoTracking()
            .Where(item => item.AuditCycleId == id).Select(item => item.FolderId).ToListAsync();
        var visibleFolderIds = new List<Guid>();
        var cycle = await context.AuditCycles.AsNoTracking().FirstAsync(item => item.AuditCycleId == id);
        var options = await setupService.GetOptionsAsync(cycle.Standard, userId, scope.CanViewAll);
        var optionsByFolderId = options.ToDictionary(option => option.FolderId);
        foreach (var folderId in folders)
            if (optionsByFolderId.TryGetValue(folderId, out var option)
                && (scope.CanViewAll || scope.DepartmentFolderIds.Contains(option.DepartmentFolderId))
                && (scope.CanViewAll || await accessOverrideService.HasFolderReadAccessAsync(userId, folderId))) visibleFolderIds.Add(folderId);
        var visibleOptions = options.Where(option => visibleFolderIds.Contains(option.FolderId)).ToArray();
        var departmentIds = visibleOptions
            .Select(option => option.DepartmentFolderId).ToHashSet();
        var contacts = await context.IsoReadinessContacts.AsNoTracking()
            .Where(item => item.AuditCycleId == id && departmentIds.Contains(item.DepartmentFolderId))
            .Select(item => new { item.DepartmentFolderId, item.UserId }).ToListAsync();
        return Ok(new { success = true, data = new { folderIds = visibleFolderIds, folders = visibleOptions.Select(option => new { option.FolderId, option.Path, option.DepartmentFolderId, option.DepartmentFolderName }), contacts } });
    }

    [HttpPut("{id:guid}/setup")]
    public async Task<ActionResult<object>> UpdateSetup(Guid id, [FromBody] AuditCycleSetupRequest setup)
    {
        var actorId = GetCurrentUserId();
        if ((await GetPageAccessRoleAsync(context, actorId))?.CanViewAdminPanel != true) return Forbid();
        var cycle = await context.AuditCycles.FirstOrDefaultAsync(item => item.AuditCycleId == id);
        if (cycle == null) return NotFound();
        if (cycle.Status == "historical") return BadRequest(new { success = false, error = "Historical audit cycles cannot be changed" });
        await using var transaction = await context.Database.BeginTransactionAsync();
        var error = await setupService.ApplyAsync(cycle, setup, actorId);
        if (error != null) return BadRequest(new { success = false, error });
        await transaction.CommitAsync();
        return Ok(new { success = true });
    }

    [HttpPost("{id:guid}/activate")]
    public async Task<ActionResult<object>> Activate(Guid id)
    {
        if ((await GetPageAccessRoleAsync(context, GetCurrentUserId()))?.CanViewAdminPanel != true) return Forbid();
        var cycle = await context.AuditCycles.FindAsync(id); if (cycle == null) return NotFound();
        var active = await context.AuditCycles.Where(c => c.Standard == cycle.Standard && c.Status == "active").ToListAsync();
        active.ForEach(c => c.Status = "historical"); cycle.Status = "active"; await context.SaveChangesAsync(); return Ok(new { success = true, data = cycle });
    }

    [HttpPost("{id:guid}/start")]
    public async Task<ActionResult<object>> Start(Guid id)
    {
        var userId = GetCurrentUserId(); if ((await GetPageAccessRoleAsync(context, userId))?.CanViewAdminPanel != true) return Forbid();
        var cycle = await context.AuditCycles.FindAsync(id); if (cycle == null || cycle.Standard != "ISO 9001:2015") return BadRequest(new { success = false, error = "Select an ISO 9001 cycle" });
        var active = await context.AuditCycles.Where(c => c.Standard == cycle.Standard && c.Status == "active" && c.AuditCycleId != id).ToListAsync(); active.ForEach(c => c.Status = "historical"); cycle.Status = "active";
        var preparation = await context.AuditCalendarEvents.FirstOrDefaultAsync(e => e.AuditCycleId == id && e.StageKey == "preparation");
        if (preparation == null) { preparation = new DmsAuditCalendarEvent { EventId = Guid.NewGuid(), AuditCycleId = id, StageKey = "preparation", Title = $"{cycle.Name} — Preparation", Phase = "Preparation", Standard = cycle.Standard, EventDate = cycle.StartDate, ProgrammeYear = cycle.StartDate.Year, Status = "in_progress", PostedBy = userId, CreatedAt = DateTime.UtcNow }; context.AuditCalendarEvents.Add(preparation); }
        await context.SaveChangesAsync(); return Ok(new { success = true, data = new { cycle.AuditCycleId, CycleStatus = cycle.Status, PreparationStatus = preparation.Status } });
    }
}
public record AuditCycleRequest(string Name, string Standard, DateOnly StartDate, DateOnly EndDate, AuditCycleSetupRequest? Setup);
