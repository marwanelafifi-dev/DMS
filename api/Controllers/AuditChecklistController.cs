using DMS.Api.Data;
using DMS.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DMS.Api.Controllers;

[ApiController]
[Route("api/audits/{auditId:guid}/checklist")]
public class AuditChecklistController(DmsContext context) : BaseController
{
    [HttpGet]
    public async Task<ActionResult<object>> List(Guid auditId)
    {
        var audit = await context.AuditRecords.AsNoTracking().FirstOrDefaultAsync(x => x.AuditRecordId == auditId);
        if (audit == null) return NotFound();
        if (!await CanAccessAuditPlanAsync(audit.Standard)) return Forbid();
        return Ok(new { success = true, data = await context.AuditChecklistItems.AsNoTracking().Where(x => x.AuditRecordId == auditId).OrderBy(x => x.Process).ThenBy(x => x.Clause).ToListAsync() });
    }

    [HttpPost]
    public async Task<ActionResult<object>> Create(Guid auditId, [FromBody] ChecklistRequest request)
    {
        var userId = GetCurrentUserId(); if ((await GetPageAccessRoleAsync(context, userId))?.CanCreatePcars != true) return Forbid();
        var audit = await context.AuditRecords.AsNoTracking().FirstOrDefaultAsync(x => x.AuditRecordId == auditId);
        if (audit == null || string.IsNullOrWhiteSpace(request.Process) || string.IsNullOrWhiteSpace(request.Clause) || string.IsNullOrWhiteSpace(request.Requirement)) return BadRequest(new { success = false, error = "Process, clause, and requirement are required" });
        if (!await CanAccessAuditPlanAsync(audit.Standard)) return Forbid();
        var item = new DmsAuditChecklistItem { AuditChecklistItemId = Guid.NewGuid(), AuditRecordId = auditId, Process = request.Process.Trim(), Clause = request.Clause.Trim(), Requirement = request.Requirement.Trim(), Result = request.Result is "conformity" or "observation" or "minor_ncr" or "major_ncr" ? request.Result : "not_assessed", ObjectiveEvidence = request.ObjectiveEvidence?.Trim(), AuditorNotes = request.AuditorNotes?.Trim(), CreatedBy = userId, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
        context.AuditChecklistItems.Add(item); await context.SaveChangesAsync(); return Ok(new { success = true, data = item });
    }

    private async Task<bool> CanAccessAuditPlanAsync(string standard)
    {
        var role = await GetPageAccessRoleAsync(context, GetCurrentUserId());
        return standard switch
        {
            "ISO 9001:2015" => role?.CanViewIso9001AuditPlan == true,
            "ISO 27001:2022" => role?.CanViewIso27001Workspace == true,
            _ => false,
        };
    }
}
public record ChecklistRequest(string Process, string Clause, string Requirement, string Result = "not_assessed", string? ObjectiveEvidence = null, string? AuditorNotes = null);
