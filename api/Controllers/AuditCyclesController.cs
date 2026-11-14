using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/audit-cycles")]
public class AuditCyclesController(DmsContext context) : BaseController
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
        var cycle = new DmsAuditCycle { AuditCycleId = Guid.NewGuid(), Name = req.Name.Trim(), Standard = req.Standard, StartDate = req.StartDate, EndDate = req.EndDate, Status = "planned", CreatedAt = DateTime.UtcNow, CreatedBy = GetCurrentUserId() };
        context.AuditCycles.Add(cycle); await context.SaveChangesAsync(); return Ok(new { success = true, data = cycle });
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
public record AuditCycleRequest(string Name, string Standard, DateOnly StartDate, DateOnly EndDate);
